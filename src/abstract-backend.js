export const BackendState = {
	UNINITIALIZED: 1,
	READY: 2,
	PLAYING: 3,
	STARVED: 4,
};
Object.freeze(BackendState);

/**
 * Buffer type options for audio backends
 */
export const BufferType = {
	RING_BUFFER: 'ring_buffer',  // Circular buffer, good for continuous playback
	FIFO_QUEUE: 'fifo_queue'     // First-in-first-out queue, good for "consume once" behavior
};
Object.freeze(BufferType);

/** Abstract class representing an Audio Backend */
export class AbstractBackend {
	/**
	 * Queues audio data for propagation to the next AudioNode in the graph
	 *
	 * @param { Float32Array } float32Array Mono or interleaved audio data
	 */
	/* eslint-disable-next-line */
	feed(float32Array) {
		throw "feed() must be implemented";
	}

	/**
	 * Connect to the given destination. Destination should be an AudioNode.
	 *
	 * @param { AudioNode } destination The AudioNode to which audio is propagated
	 */
	/* eslint-disable-next-line */
	connect(destination) {
		throw "connect() must be implemented";
	}

	/** Disconnect from the currently-connected destination. */
	disconnect() {
		throw "disconnect() must be implemented";
	}

	/**
	 * Gets the current fill level of the ring buffer
	 * 
	 * @returns {number} The current number of samples in the buffer
	 */
	getCurrentBufferFill() {
		throw "getCurrentBufferFill() must be implemented";
	}
	

	/**
	 * Sets a MessageChannel Port to receive processed data from. Should be, but doesn't *have* to be
	 * implemented by subclasses.
	 *
	 * @param { MessagePort } port port1 or port2 from a MessageChannel
	 */
	/* eslint-disable-next-line */
	setPort(port) {}

	/**
	 * Called whenever the state changes (playing, silent, etc.) Override me.
	 *
	 * @param {BackendState} state One of BackendState
	 */
	/* eslint-disable-next-line */
	onStateChange(state) {}

	/**
	 * Gets the type of buffer being used by this backend
	 * 
	 * @returns {string} The buffer type (one of BufferType)
	 */
	getBufferType() {
		throw "getBufferType() must be implemented";
	}
	
	/**
	 * Clears all audio data from the buffer
	 */
	clearBuffer() {
		throw "clearBuffer() must be implemented";
	}
}
