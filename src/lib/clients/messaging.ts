import { LibraryResponse } from '@/types/get-library';
import consola from 'consola';

const logger = consola.withTag('messaging');

export class MessagingClient {
  async sendMessage<T>(opts: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(opts, (response) => {
          if (chrome.runtime.lastError) {
            logger.error('Runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response as T);
        });
      } catch (error) {
        logger.error('Error sending message:', error);
        reject(error);
      }
    });
  }

  async getEpicToken(): Promise<string> {
    const response = await this.sendMessage<
      { token: string } | { error: string }
    >({
      action: 'getEpicToken',
    });

    if ('error' in response) {
      throw new Error(response.error);
    }

    return response.token;
  }

  async getLibrary({
    cursor,
  }: { cursor?: string } = {}): Promise<LibraryResponse> {
    const response = await this.sendMessage<
      { library: LibraryResponse } | { error: string }
    >({
      action: 'getLibrary',
      payload: { cursor, excludeNs: ['ue'] },
    });

    if (!response) {
      throw new Error('No response from messaging client');
    }

    if ('error' in response) {
      logger.error('Error getting Epic Games library', response.error);
      throw new Error(response.error);
    }

    if (!response.library?.items) {
      throw new Error('Invalid library response: missing items array');
    }

    return response.library;
  }
}

export const messagingClient = new MessagingClient();
