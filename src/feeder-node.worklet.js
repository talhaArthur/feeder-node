import RingBuffer from "./ring-buffer.js";
import AudioQueue from "./audio-queue.js";
import { writeSilence } from "./util.js";
import { BackendState, BufferType } from "./abstract-backend";

const BATCH_SIZE = 128; // non-negotiable (thanks AudioWorklet)

/** AudioWorkletProcessor loaded by audio-worklet-backend to do the audio-thread processing */
export default class WorkletProcessor extends AudioWorkletProcessor {
	/* eslint-disable-next-line */
	constructor(options) {
		super();
		this.port.onmessage = this._onMessage.bind(this);

		this.bufferThreshold;
		this.nChannels;
		this.state = BackendState.UNINITIALIZED;
		this._bufferType = BufferType.RING_BUFFER; // default to ring buffer
		
	}

	/**
	 * Called whenever the AudioWorkletProcessor has data to process/playback
	 *
	 * @param {Array} inputs      An array containing 0 Float32Arrays. unused
	 * @param {Array} outputs     An array containing this.nChannels Float32Arrays
	 * @param {Object} parameters Object containing audio parameters. unused
	 */
	/* eslint-disable-next-line */
	process(inputs, outputs, parameters) {
		this._updateState();
	  
		if (this.state === BackendState.PLAYING) {
		  this._buffer.read(BATCH_SIZE, outputs[0]);
		} else {
		  writeSilence(outputs[0]);
		}
	  
		return true;
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

		if (staleState != this.state) this._notifyStateChange();
	}

	/**
	 * Notifies the parent FeederNode of the state change
	 */
	_notifyStateChange() {
		this.port.postMessage({ command: "stateChange", state: this.state });
	}

	/**
	 * Called whenever the AudioWorkletProcessor received a message from the main thread. Use to initialize
	 * values and receive audio data.
	 *
	 * @param {Event} e https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
	 */
	_onMessage(e) {
		let data = e.data;
		let command = data.command;

		if (command === "init") {
			this._bufferType = data.bufferType;
			this._init(data.bufferLength, data.nChannels, data.bufferThreshold);
		} else if (command === "feed") {
			this._feed(data.data);
		} else if (command === "setBufferThreshold") {
			this.bufferThreshold = data.threshold;
		} else if (command === "connect") {
			e.ports[0].onmessage = this._onMessage.bind(this);
		} else if (command === "getBufferFill") {
			this._sendBufferFill(data.callbackId);
		} else if (command === "clearBuffer") {
			if (this._buffer) {
				this._buffer.clear();
			}
		} else {
			throw Error("command not specified");
		}
	}

	/**
	 * Sends the current buffer fill level back to the main thread
	 * 
	 * @param {number} callbackId Optional ID to identify the callback on the main thread
	 */
	_sendBufferFill(callbackId) {
		if (!this._buffer) {
			return;
		}
		
		const bufferFill = this._buffer.getNReadableSamples();
		this.port.postMessage({
			command: "bufferFillUpdate",
			bufferFill: bufferFill,
			callbackId: callbackId
		});
	}

	/**
	 * Queues audio data to be played back
	 *
	 * @param {Float32Array} float32Array interleaved (if channels > 0) audio data
	 */
	_feed(float32Array) {

		// Normal path - write to buffer
		let [didResize, bufferLength] = this._buffer.write(float32Array);

		if (didResize) {

			this.port.postMessage({
				command: "bufferLengthChange",
				bufferLength: bufferLength,
			});
		}
		
		// Send buffer fill update after adding new data
		this._sendBufferFill();
	}

	/**
	 * Initializes with the given values. This should be called immediately after loading the processor.
	 *
	 * @param {Number} bufferLength    the length of the buffer
	 * @param {Number} nChannels       the number of outputs channels
	 * @param {Number} bufferThreshold # of samples (per channel) to queue before transmission to output begins
	 */
	_init(bufferLength, nChannels, bufferThreshold) {
		// Create the appropriate buffer based on type
		if (this._bufferType === BufferType.FIFO_QUEUE) {
			this._buffer = new AudioQueue(bufferLength, nChannels);
		} else {
			this._buffer = new RingBuffer(bufferLength, nChannels);
		}
		
		this.bufferThreshold = bufferThreshold;
		this.state = BackendState.READY;
		
		
		this._notifyStateChange();
	}
}

registerProcessor("FeederNode", WorkletProcessor);
