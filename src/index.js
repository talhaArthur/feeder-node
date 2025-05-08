import ScriptProcessorBackend from "./script-processor-backend";
import MainThreadResampler from "./main-thread-resampler";

import createAudioWorklet from "./audio-worklet-backend";
import createWorkerResampler from "./worker-resampler";

import FeederNode from "./feeder-node";
import { BufferType } from "./abstract-backend";

import { ConverterType } from "@alexanderolsen/libsamplerate-js";

// The batch sizes which ScriptProcessorNode supports. AudioWorklet only support 128.
const VALID_BATCH_SIZES = [128, 256, 512, 1024, 2048, 4096, 8192, 16384];

/**
 * Creates a new instance of FeederNode
 *
 * `options` is an object which supports the follow members:
 * {
 *     batchSize:           { Number } default 512. Stuck at 128 for `AudioWorklet`s
 *     bufferThreshold:     { Number } default 4096. Number of samples to buffer before propagating to destination
 *     bufferLength:        { Number } default 192000. Length of buffer. See ring-buffer.js for more
 *     bufferType:          { String } default 'ring_buffer'. Type of buffer to use ('ring_buffer' or 'fifo_queue')
 *     resampConverterType: { Number } default ConverterType.SRC_SINC_FASTEST. See http://www.mega-nerd.com/SRC/api_misc.html#Converters
 *     inputSampleRate:     { Number } default context.sampleRate
 *     pathToWorklet:       { String } default '/feeder-node.processor.js'. See README for more
 *     pathToWorker:        { String } default '/feeder-node.worker.js'. See README for more
 *     pathToWasm:          { String } default '/feeder-node.wasm.js'. See README for more
 * }
 *
 * @param  { AudioContext } context   The parent audio context.
 * @param  { Number }       nChannels The number of input and output channels.
 * @param  { Object }       options   See above
 * @return { Promise }                Promise which resolves with a FeederNode instance or rejects with error message.
 */
export async function createNode(context, nChannels, options = {}) {
	let batchSize =
		options.batchSize || (window.AudioWorklet !== undefined ? 128 : 512);
	let bufferThreshold = options.bufferThreshold || 4096;
	let bufferLength = options.bufferLength || 192000;
	let bufferType = options.bufferType || BufferType.RING_BUFFER;
	let converterType =
		options.resampConverterType === undefined
			? ConverterType.SRC_SINC_FASTEST
			: options.resampConverterType;
	let inputSampleRate = options.inputSampleRate || context.sampleRate;
	let outputSampleRate = context.sampleRate;

	let pathToWorklet = options.pathToWorklet || "/feeder-node.worklet.js";
	let pathToWorker = options.pathToWorker || "/feeder-node.worker.js";
	let pathToWasm = options.pathToWasm || "/libsamplerate.wasm";
	

	validate(
		nChannels,
		batchSize,
		bufferThreshold,
		bufferLength,
		converterType,
		inputSampleRate,
		bufferType
	);

	// **BACKEND MUST BE CREATED FIRST.** After `createSampler`'s async initialization,  touch events in Safari
	// are no longer active and therefore `ScriptProcessorNode`s won't initialize correctly
	let backend = await createBackend(
		context,
		nChannels,
		batchSize,
		bufferLength,
		bufferThreshold,
		pathToWorklet,
		bufferType
	);
	let resampler = await createResampler(
		nChannels,
		inputSampleRate,
		outputSampleRate,
		converterType,
		pathToWorker,
		pathToWasm
	);

	let feederNode = new FeederNode(resampler, backend);
	
	
	return feederNode;
}


/**
 * Creates a new instance of FeederNode with a FIFO queue buffer (consume once behavior)
 * This is a convenience method that calls createNode with the appropriate buffer type.
 *
 * @param  { AudioContext } context   The parent audio context.
 * @param  { Number }       nChannels The number of input and output channels.
 * @param  { Object }       options   Same as createNode options, but uses FIFO queue buffer type
 * @return { Promise }                Promise which resolves with a FeederNode instance or rejects with error message.
 */
export async function createQueueNode(context, nChannels, options = {}) {
	// Set buffer type to FIFO queue
	options.bufferType = BufferType.FIFO_QUEUE;
	
	return createNode(context, nChannels, options);
}

/**
 * Validate input used to create an FeederNode
 *
 * @param { Number } nChannels       The number of input and output channels
 * @param { Number } batchSize       Must be one of VALID_BATCH_SIZES.
 * @param { Number } bufferThreshold Number of samples which must be buffered before playback begins
 * @param { Number } bufferLength    Buffer length in samples (per channel). See ring-buffer.js for more.
 * @param { Number } converterType   libsamplerate-js ConverterType. See libsamplerate for more.
 * @param { Number } inputSampleRate Sample rate of input data
 * @param { String } bufferType      The type of buffer to use (ring_buffer or fifo_queue)
 */
function validate(
	nChannels,
	batchSize,
	bufferThreshold,
	bufferLength,
	converterType,
	inputSampleRate,
	bufferType
) {
	if (nChannels === undefined) throw "nChannels is undefined";

	if (nChannels < 1 || nChannels > 2) throw `invalid nChannels ${nChannels}`;
	if (!VALID_BATCH_SIZES.includes(batchSize))
		throw `invalid batchSize ${batchSize}`;
	if (bufferLength < 16384) throw "buffer length must be greater than 16384";
	if (bufferThreshold < 0) throw "bufferThreshold cannot be less than 0";
	if (bufferThreshold > bufferLength)
		throw "bufferThreshold cannot be greater than bufferLength";
	if (converterType < 0 || converterType > 4)
		throw `invalid converterType ${converterType}`;
	if (inputSampleRate < 1 || inputSampleRate > 192000)
		throw `invalid inputSampleRate ${inputSampleRate}`;
	if (bufferType !== BufferType.RING_BUFFER && bufferType !== BufferType.FIFO_QUEUE)
		throw `invalid bufferType ${bufferType}`;
}

/**
 * Creates a resampler to be used by FeederNode. All resamplers extends AbstractProcessor.
 * If WebAssembly is supported in current browser, loads libsamplerate-js and run it in a
 * Web Worker. If not, resamples audio data on the main thread using resampler.js linear interpolation.
 *
 * @param  { Number } nChannels        The number of input and output channels
 * @param  { Number } inputSampleRate  Sample rate of input data
 * @param  { Number } outputSampleRate Sample rate of output data. Probably came from AudioContext.sampleRate
 * @param  { Number } converterType    libsamplerate-js ConverterType. See libsamplerate for more.
 * @return { AbstractProcessor }       The resampler to use
 */
async function createResampler(
	nChannels,
	inputSampleRate,
	outputSampleRate,
	converterType,
	pathToWorker,
	pathToWasm
) {
	// initialize the sample rate converter
	if (window.WebAssembly !== undefined) {
		// web assembly supported. use libsamplerate-js
		return await createWorkerResampler(
			nChannels,
			inputSampleRate,
			outputSampleRate,
			converterType,
			pathToWorker,
			pathToWasm
		);
	} else {
		// web assembly != supported. resample on the main thread using linear interpolation
		return new MainThreadResampler(
			nChannels,
			inputSampleRate,
			outputSampleRate
		);
	}
}

/**
 * Creates a Backend to be used by FeederNode. Backends extend AbstractBackend. If AudioWorklet
 * is supported, creates an AudioWorkletBackend. Otherwise, plays audio using ScriptProcessorNode.
 *
 * @param  { AudioContext } context         Audio context in which this node participates
 * @param  { Number }       nChannels       The number of input and output channels
 * @param  { Number }       batchSize       Must be one of VALID_BATCH_SIZES.
 * @param  { Number }       bufferThreshold Number of samples which must be buffered before playback begins
 * @param  { Number }       bufferLength    Buffer length in samples (per channel)
 * @param  { String }       pathToWorklet   Path from server root to feeder-node.worklet.js
 * @param  { String }       bufferType      The type of buffer to use (ring_buffer or fifo_queue)
 * @return { AbstractBackend }              The backend to perform audio propagation with.
 */
async function createBackend(
	context,
	nChannels,
	batchSize,
	bufferLength,
	bufferThreshold,
	pathToWorklet,
	bufferType = BufferType.RING_BUFFER
) {
	// initialize the backend
	if (window.AudioWorklet !== undefined) {
		// AudioWorklet is supported. use it.
		return await createAudioWorklet(
			context,
			nChannels,
			bufferLength,
			bufferThreshold,
			pathToWorklet,
			bufferType
		);
	} else {
		// AudioWorklet isn't support. Fall back to ScriptProcessorNode
		return new ScriptProcessorBackend(
			context,
			nChannels,
			batchSize,
			bufferLength,
			bufferThreshold,
			bufferType
		);
	}
}

// Export for backwards compatibility
export const createFeederNode = createNode;

// Export buffer types
export { BufferType };
