import type { ModelTransportAdapter } from '../../application/src/index.js';
import { AnthropicMessagesModelAdapter } from './anthropic-messages-adapter.js';
import {
  ModelAdapterError,
  OpenAiCompatibleModelAdapter,
  type ModelOutboundEndpointPolicy,
} from './openai-compatible-adapter.js';

export class CompositeModelTransportAdapter implements ModelTransportAdapter {
  readonly #openAi: OpenAiCompatibleModelAdapter;
  readonly #anthropic: AnthropicMessagesModelAdapter;

  constructor(endpointPolicy: ModelOutboundEndpointPolicy = {}) {
    this.#openAi = new OpenAiCompatibleModelAdapter(endpointPolicy);
    this.#anthropic = new AnthropicMessagesModelAdapter(endpointPolicy);
  }

  generateStructured(input: Parameters<ModelTransportAdapter['generateStructured']>[0]) {
    return this.#adapter(input.configuration.apiStyle).generateStructured(input);
  }

  embed(input: Parameters<ModelTransportAdapter['embed']>[0]) {
    return this.#adapter(input.configuration.apiStyle).embed(input);
  }

  #adapter(apiStyle: string): ModelTransportAdapter {
    if (apiStyle === 'openai_chat_completions') return this.#openAi;
    if (apiStyle === 'anthropic_messages') return this.#anthropic;
    throw new ModelAdapterError('MODEL_API_STYLE_UNSUPPORTED', 'Model API style is unsupported.');
  }
}
