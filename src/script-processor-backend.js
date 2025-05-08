import { AbstractBackend, BackendState, BufferType } from "./abstract-backend";
import RingBuffer from "./ring-buffer";
import AudioQueue from "./audio-queue";
import { writeSilence } from "./util";

/** Class that manages a ScriptProcessor to playback PCM audio */
export default class ScriptProcessorBackend extends AbstractBackend {
	/**
	 *
	 * @param { AudioContext } context         The parent AudioContext
	 * @param { Number }       nChannels       The number of input and output channels
	 * @param { Number }       batchSize       The number of samples (per channel) processed per call to
	 *                                         _playNext(). Generally, higher values (2048, 4096, 8192...)
	 *                                         should be preferred to reduce CPU load
	 * @param { Number }       bufferLength    The length of the buffer. See ring-buffer.js for more
	 * @param { Number }       bufferThreshold The minimum number of sample which must be buffered before
	 *                                         audio begins propagating to the next AudioNode in the graph
	 * @param { String }       bufferType      The type of buffer to use (ring_buffer or fifo_queue)
	 */
	constructor(context, nChannels, batchSize, bufferLength, bufferThreshold, bufferType = BufferType.RING_BUFFER) {
		super();

		this.batchSize = batchSize;
		this.nChannels = nChannels;
		this.bufferThreshold = bufferThreshold;
		this.audioNode = context.createScriptProcessor(batchSize, 0, nChannels);
		this.audioNode.onaudioprocess = this._playNext.bind(this);
		this._bufferType = bufferType;

		// Create the appropriate buffer based on type
		if (bufferType === BufferType.FIFO_QUEUE) {
			this._buffer = new AudioQueue(bufferLength, nChannels);
		} else {
			this._buffer = new RingBuffer(bufferLength, nChannels);
		}
		
		this.state = BackendState.READY;
	}

	/** getter */
	get bufferLength() {
		return this._buffer.bufferLength;
	}

	/**
	 * Appends data to the buffer. If float32Array.length > the current buffer size,
	 * buffer will automatically resize to fit the new chunk if it's a RingBuffer
	 *
	 * @param {Float32Array} data to write to the buffer
	 */
	feed(float32Array) {
		this._buffer.write(float32Array);
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
		this._buffer.clear();
	}

	/**
	 * Connects the ScriptProcessorNode to the given destination AudioNode
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
	 * Gets the current fill level of the ring buffer
	 * 
	 * @returns {number} The current number of samples in the buffer
	 */
	getCurrentBufferFill() {
		return this._buffer.getNReadableSamples();
	}

	/**
	 * Changes state depending on how much data is available to read into AudioNode chain. If
	 * WorkletProcess runs out of data, switches to STARVED; once it buffers enough data, switch
	 * back to PLAYING
	 */
	_updateState() {
		let staleState = this.state;

		switch (this.state) {
			case BackendState.UNINITIALIZED:
				return;
			case BackendState.PLAYING:
				if (this._buffer.getNReadableSamples() === 0)
					this.state = BackendState.STARVED;
				break;
			case BackendState.READY:
			case BackendState.STARVED:
				if (this._buffer.getNReadableSamples() >= this.bufferThreshold)
					this.state = BackendState.PLAYING;
				break;
			default:
		}

		if (staleState != this.state) this.onStateChange(this.state);
	}

	/**
	 * Called whenever the ScriptProcessor wants to consume more audio
	 *
	 * @param {AudioProcessingEvent} https://developer.mozilla.org/en-US/docs/Web/API/AudioProcessingEvent
	 */
	_playNext(audioProcessingEvent) {
		this._updateState();

		let outs = Array.apply(null, Array(this.nChannels)).map((x, i) => {
			return audioProcessingEvent.outputBuffer.getChannelData(i);
		});

		if (this.state === BackendState.PLAYING) {
			this._buffer.read(this.batchSize, outs);
		} else {
			writeSilence(outs);
		}
	}

	/**
	 * Sets a new buffer threshold value
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
		
		this.bufferThreshold = threshold;
	}
}
