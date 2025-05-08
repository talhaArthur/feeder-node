import { BackendState, BufferType } from "./abstract-backend";
import { toFloat32 } from "./util";

export default class FeederNode {
	/**
	 * Constructor
	 *
	 * @param { AbstractProcessor } resampler Resamples data before handing to the backend for propagation
	 * @param { AbstractBackend }   backend   Propagates audio data to the next AudioNode in the graph
	 */
	constructor(resampler, backend) {
		// init MessageChannel if using both async resampler and backend
		if (
			resampler.constructor.name === "WorkerResampler" &&
			backend.constructor.name === "AudioWorkletBackend"
		) {
			let channel = new MessageChannel();
			resampler.setPort(channel.port1);
			backend.setPort(channel.port2);
		}

		// set callbacks
		resampler.onProcessed = this._onResampleComplete.bind(this);
		backend.onStateChange = this._onBackendStateChange.bind(this);

		this._resampler = resampler;
		this._backend = backend;
	}

	/** getters */
	get bufferLength() {
		return this._backend.bufferLength;
	}
	get nChannels() {
		return this._backend.nChannels;
	}
	get batchSize() {
		return this._backend.batchSize;
	}
	get bufferThreshold() {
		return this._backend.bufferThreshold;
	}

	/**
	 * Sets a new buffer threshold value
	 * 
	 * @param {Number} threshold The new buffer threshold value
	 */
	setBufferThreshold(threshold) {
		this._backend.setBufferThreshold(threshold);
	}

	/** AudioNode-compliant getters. All defer to underlying AudioNode */
	get numberOfInputs() {
		return this._backend.audioNode.numberOfInputs;
	}
	get numberOfOutputs() {
		return this._backend.audioNode.numberOfOutputs;
	}
	get channelCount() {
		return this._backend.audioNode.channelCount;
	}
	get channelCountMode() {
		return this._backend.audioNode.channelCountMode;
	}
	get channelInterpretation() {
		return this._backend.audioNode.channelInterpretation;
	}

	/** AudioNode-compliant setters. All defer to underlying AudioNode */
	set channelCount(channelCount) {
		this._backend.audioNode.channelCount = channelCount;
	}
	set channelCountMode(channelCountMode) {
		this._backend.audioNode.channelCountMode = channelCountMode;
	}
	set channelInterpretation(channelInterpretation) {
		this._backend.audioNode.channelInterpretation = channelInterpretation;
	}

	/**
	 * Connects FeederNode to the specific destination AudioNode
	 *
	 * @param {AudioNode} destination The node to connect to
	 */
	connect(destination) {
		this._backend.connect(destination);
	}

	/** Disconnects from the currently-connected AudioNode */
	disconnect() {
		this._backend.disconnect();
	}

	/**
	 * Feeds raw PCM audio data to the underlying node. Any kind of TypedArray can be submitted - FeederNode
	 * will automatically convert to Float32 and scale to -1 < n < 1.
	 *
	 * @param {TypedArray} data Any TypedArray. Conversion will be done automatically
	 */
	feed(data) {
		let parsedData;

		if (ArrayBuffer.isView(data)) {
			parsedData = toFloat32(data);
		} else {
			throw Error(
				`FeederNode.feed() must receive an instance of TypedArray. You passed ${data.constructor.name}`
			);
		}

		this._resampler.processBatch(parsedData);
	}

	/**
	 * Returns the current fill level of the ring buffer
	 * 
	 * @returns {number} The current number of samples in the buffer
	 */
	getCurrentBufferFill() {
		return this._backend.getCurrentBufferFill();
	}
	
	

	/**
	 * Calculates the health of the buffer as a normalized value between 0-1
	 * 0 means empty, 1 means full or overfull
	 * 
	 * @returns {number} Buffer health value normalized between 0-1
	 */
	getBufferHealth() {
		const currentFill = this.getCurrentBufferFill();
		const maxFill = this.bufferLength;
		return Math.min(1, Math.max(0, currentFill / maxFill));
	}

	/** Override these for Backend state callbacks */
	onBackendReady() {}
	onBackendPlaying() {}
	onBackendStarved() {}

	/**
	 * Called by this._resampler if a MessageChannel isn't in use to transfer data from the
	 * resampler directly to the backend
	 *
	 * @param {Float32Array} float32Array Mono or interleaved audio data
	 */
	_onResampleComplete(float32Array) {
		this._backend.feed(float32Array);
	}

	/**
	 * Called by the back whenever its state changes
	 *
	 * @param { BackendState } state one of [BackendState.READY, BackendState.PLAYING, BackendState.STARVED]
	 */
	_onBackendStateChange(state) {
		switch (state) {
			case BackendState.READY:
				return this.onBackendReady();
			case BackendState.PLAYING:
				return this.onBackendPlaying();
			case BackendState.STARVED:
				return this.onBackendStarved();
			default:
				throw `unknown state ${state}`;
		}
	}

	/**
	 * Returns the buffer type being used by the backend
	 * 
	 * @returns {string} Buffer type (one of BufferType)
	 */
	getBufferType() {
		return this._backend.getBufferType();
	}
	
	/**
	 * Clears all audio data from the buffer
	 */
	clearBuffer() {
		this._backend.clearBuffer();
	}
}
