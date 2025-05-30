import { AbstractBackend, BackendState, BufferType } from "./abstract-backend";

/**
 * Loads the AudioWorkletProcessor, initializes it, then resolves with a new instance of AudioWorkletBackend
 *
 * @param { AudioContext } context         The parent AudioContext
 * @param { Number }       nChannels       The number of input and output channels
 * @param { Number }       bufferLength    The length of the buffer. See ring-buffer.js for more
 * @param { Number }       bufferThreshold The minimum number of sample which must be buffered before
 *                                         audio begins propagating to the next AudioNode in the graph
 * @param { String }       pathToWorklet   The location of the AudioWorklet file. Default is
 *                                         '/audio-feeder.worklet.js'
 * @param { String }       bufferType      The type of buffer to use (ring_buffer or fifo_queue)
 */
export default function createAudioWorklet(
	context,
	nChannels,
	bufferLength,
	bufferThreshold,
	pathToWorklet,
	bufferType = BufferType.RING_BUFFER
) {
	let _nChannels = nChannels;

	// define this here so that window is accessible
	class WorkletNode extends AudioWorkletNode {
		constructor(context) {
			super(context, "FeederNode", {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [_nChannels],
			});
		}
	}

	return new Promise((resolve) => {
		context.audioWorklet.addModule(pathToWorklet).then(() => {
			let workletNode = new WorkletNode(context);
			workletNode.port.postMessage({
				command: "init",
				nChannels: nChannels,
				bufferLength: bufferLength,
				bufferThreshold: bufferThreshold,
				bufferType: bufferType
			});

			let backend = new AudioWorkletBackend(
				nChannels,
				bufferLength,
				workletNode,
				bufferType
			);
			resolve(backend);
		});
	});
}

/** Audio backend which plays + processes audio on the Audio Thread */
class AudioWorkletBackend extends AbstractBackend {
	/**
	 * Constructor.
	 *
	 * @param { Number }       nChannels    The number of input and output channels
	 * @param { Number }       bufferLength The length of the buffer. See ring-buffer.js for more
	 * @param { AudioNode }    audioNode    The initialized AudioWorkletProcessor
	 * @param { String }       bufferType   The type of buffer being used
	 */
	constructor(nChannels, bufferLength, audioNode, bufferType = BufferType.RING_BUFFER) {
		super();

		this.nChannels = nChannels;
		this.bufferLength = bufferLength;
		this.audioNode = audioNode;
		this.batchSize = 128;
		this.state = BackendState.READY;
		this._currentBufferFill = 0;
		this._bufferFillCallbacks = new Map();
		this._nextCallbackId = 1;
		this._bufferType = bufferType;
		
		audioNode.port.onmessage = this._onMessage.bind(this);
	}

	/**
	 * Passes data to the AudioWorkletProcessor for playback
	 */
	feed(float32Array) {
		if (this.state === BackendState.UNINITIALIZED) {
			console.warn("tried to call feed() on uninitialized backend");
		} else {
			this.audioNode.port.postMessage({ command: "feed", data: float32Array }, [
				float32Array.buffer,
			]);
		}
	}

	/**
	 * Passes the port the audioNode to receive data directly from resamplers.
	 *
	 * @param { MessagePort } port port1 or port2 from a MessageChannel
	 */
	setPort(port) {
		this.audioNode.port.postMessage({ command: "connect" }, [port]);
	}

	/**
	 * Loads + intializes the AudioWorkletProcessor, then connects it to the provided destination AudioNode
	 *
	 * @param {AudioNode} destination The node to which FeederNode will connect
	 */
	connect(destination) {
		this.audioNode.connect(destination);
	}

	/**
	 * Disconnect from the connected AudioNode
	 */
	disconnect() {
		this.audioNode.disconnect();
	}

	/**
	 * Gets the current fill level of the ring buffer from the AudioWorklet.
	 * This is implemented in two ways:
	 * 1. Returns the last known buffer fill value for synchronous usage
	 * 2. Requests an updated value from the worklet, which will be available on the next call
	 * 
	 * @returns {number} The current number of samples in the buffer
	 */
	getCurrentBufferFill() {
		// Request an update for next time
		this.audioNode.port.postMessage({ command: "getBufferFill" });
		
		// Return the current known value
		return this._currentBufferFill;
	}
	
	/**
	 * Sets a new buffer threshold value and sends it to the worklet processor
	 * 
	 * @param {Number} threshold The new buffer threshold value
	 */
	setBufferThreshold(threshold) {
		// Validate the threshold
		if (threshold < 0) {
			throw "bufferThreshold cannot be less than 0";
		}
		if (threshold > this.bufferLength) {
			throw "bufferThreshold cannot be greater than bufferLength";
		}
		
		// Send the new threshold to the worklet processor
		this.audioNode.port.postMessage({
			command: "setBufferThreshold",
			threshold: threshold
		});
	}

	/**
	 * Called whenever a message from the AudioWorkletProcessor is received
	 *
	 * @param {Event} e https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
	 */
	_onMessage(e) {
		if (e.data.command === "bufferLengthChange") {
			this.bufferLength = e.data.bufferLength;
		} else if (e.data.command === "stateChange") {
			this.onStateChange(e.data.state);
		} else if (e.data.command === "bufferFillUpdate") {
			this._currentBufferFill = e.data.bufferFill;
			
			
			// Resolve any pending callbacks
			if (e.data.callbackId && this._bufferFillCallbacks.has(e.data.callbackId)) {
				const callback = this._bufferFillCallbacks.get(e.data.callbackId);
				callback(this._currentBufferFill);
				this._bufferFillCallbacks.delete(e.data.callbackId);
			}
	
		} else {
			throw `command ${e.data.command} unrecognized`;
		}
	}

	/**
	 * Gets the type of buffer being used by this backend
	 * 
	 * @returns {string} The buffer type (one of BufferType)
	 */
	getBufferType() {
		return this._bufferType;
	}
	
	/**
	 * Clears all audio data from the buffer
	 */
	clearBuffer() {
		this.audioNode.port.postMessage({ command: "clearBuffer" });
	}
}
