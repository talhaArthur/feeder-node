import { AbstractBackend } from "../abstract-backend.js";

export default class ScriptProcessorBackend extends AbstractBackend {
	constructor(context, nChannels, batchSize, bufferLength, bufferThreshold) {
		super();

		this.context = context;
		this.nChannels = nChannels;
		this.batchSize = batchSize;
		this.bufferLength = bufferLength;
		this.bufferThreshold = bufferThreshold;
		this.audioNode = context.createScriptProcessor(batchSize, 0, nChannels);
	}

	feed(float32Array) {
		this.data = float32Array;
	}

	connect(output) {
		this.output = output;
	}

	disconnect() {
		this.destination = null;
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
