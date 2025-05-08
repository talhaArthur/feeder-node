class AudioQueue {
	/**
	 * Constructor
	 *
	 * @param { Number } initialCapacity Initial capacity of the queue (in samples). Will grow as needed.
	 * @param { Number } nChannels The number of channels. 0 < nChannel < "infinity"
	 */
	constructor(initialCapacity = 32768, nChannels = 2) {
		if (initialCapacity <= 0) throw "initialCapacity must be >= 1";
		if (nChannels < 1) throw "nChannels must >= 1";

		this._queue = [];
		this._nChannels = nChannels;
		this._initialCapacity = initialCapacity;
		this._samplesInQueue = 0;
	}

	get bufferLength() {
		return this._samplesInQueue;
	}

	/**
	 * Returns the number of samples available. This number is per channel, not summed over the channels
	 *
	 * @return { Number } The number of available samples per channel
	 */
	getNReadableSamples() {
		return this._samplesInQueue;
	}

	/**
	 * Reads the specified number of samples (per channel) from the queue and removes them
	 *
	 * @param  {Number} nSamples The number of samples (per channel) to read
	 * @param  {Array} channels Optional pre-allocated arrays to write into
	 * @return {Array} An array of Float32Arrays with the read data
	 */
	read(nSamples, channels = null) {
		let readableSamples = Math.min(nSamples, this.getNReadableSamples());
		
		// If nothing to read, return empty arrays
		if (readableSamples === 0) {
			return channels === null 
				? Array.apply(null, Array(this._nChannels)).map(() => new Float32Array(0))
				: channels.map(ch => ch.fill(0, 0, nSamples));
		}

		let _channels = channels === null
			? Array.apply(null, Array(this._nChannels)).map(() => new Float32Array(nSamples))
			: channels;
		
		// Fill channels with zeros initially if we're using provided arrays
		if (channels !== null) {
			for (let j = 0; j < _channels.length; j++) {
				_channels[j].fill(0);
			}
		}

		let samplesRead = 0;
		
		while (samplesRead < readableSamples && this._queue.length > 0) {
			const chunk = this._queue[0];
			const samplesInChunk = chunk.length / this._nChannels;
			const samplesToReadFromChunk = Math.min(samplesInChunk, readableSamples - samplesRead);
			
			// Copy data from chunk to output channels
			for (let i = 0; i < samplesToReadFromChunk; i++) {
				for (let j = 0; j < this._nChannels; j++) {
					_channels[j][samplesRead + i] = chunk[i * this._nChannels + j];
				}
			}
			
			if (samplesToReadFromChunk === samplesInChunk) {
				// We've consumed the entire chunk
				this._queue.shift();
			} else {
				// We've consumed part of the chunk, keep the rest
				this._queue[0] = chunk.slice(samplesToReadFromChunk * this._nChannels);
			}
			
			samplesRead += samplesToReadFromChunk;
		}
		
		this._samplesInQueue -= samplesRead;
		
		return _channels;
	}

	/**
	 * Writes data to the queue
	 *
	 * @param  { Float32Array } float32Data Mono or multi-channel interleaved data
	 * @return { Array } Array containing [false, samplesInQueue] (didResize is always false for queue)
	 */
	write(float32Data) {
		if (!ArrayBuffer.isView(float32Data))
			throw `Must submit a TypedArray. Received ${float32Data.constructor.name}`;
		
		// Make a copy of the data and add it to the queue
		const copy = new Float32Array(float32Data);
		this._queue.push(copy);
		
		// Update sample count
		this._samplesInQueue += copy.length / this._nChannels;
		
		return [false, this._samplesInQueue];
	}

	/**
	 * Clears all data from the queue
	 */
	clear() {
		this._queue = [];
		this._samplesInQueue = 0;
	}
}

export default AudioQueue; 