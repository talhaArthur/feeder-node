import { AbstractBackend } from "../abstract-backend.js";

export default function createAudioWorklet(
	context,
	nChannels,
	batchSize,
	bufferLength,
	bufferThreshold,
	pathToWorklet
) {
	return new Promise((resolve) => {
		resolve(
			new AudioWorkletBackend(
				context,
				nChannels,
				batchSize,
				bufferLength,
				bufferThreshold,
				pathToWorklet
			)
		);
	});
}

class AudioWorkletBackend extends AbstractBackend {
	constructor(
		context,
		nChannels,
		batchSize,
		bufferLength,
		bufferThreshold,
		pathToWorklet
	) {
		super();

		this.context = context;
		this.nChannels = nChannels;
		this.batchSize = batchSize;
		this.bufferLength = bufferLength;
		this.bufferThreshold = bufferThreshold;
		this.pathToWorklet = pathToWorklet;
	}

	feed(float32Array) {
		this.data = float32Array;
	}

	connect(output) {
		this.output = output;
	}

	disconnect() {
		this.output = null;
	}

	setPort(port) {
		this.port = port;
	}
	
	setBufferThreshold(threshold) {
		if (threshold < 0) {
			throw "bufferThreshold cannot be less than 0";
		}
		if (threshold > this.bufferLength) {
			throw "bufferThreshold cannot be greater than bufferLength";
		}
		
		this.bufferThreshold = threshold;
	}
}
