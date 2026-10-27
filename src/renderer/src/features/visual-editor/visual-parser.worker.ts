import { importLatex } from './latex-adapter';

interface ParseRequest {
  generation: number;
  source: string;
  modelVersion: number;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { generation, source, modelVersion } = event.data;
  try {
    self.postMessage({ generation, modelVersion, projection: importLatex(source) });
  } catch {
    self.postMessage({
      generation,
      modelVersion,
      error: 'This document could not be opened in Visual mode.',
    });
  }
};
