import { importLatex, type VisualImportOptions } from './latex-adapter';

interface ParseRequest {
  generation: number;
  source: string;
  modelVersion: number;
  options?: VisualImportOptions;
  optionsKey?: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { generation, source, modelVersion, options, optionsKey } = event.data;
  try {
    self.postMessage({
      generation,
      modelVersion,
      optionsKey,
      projection: importLatex(source, options),
    });
  } catch {
    self.postMessage({
      generation,
      modelVersion,
      optionsKey,
      error: 'This document could not be opened in Visual mode.',
    });
  }
};
