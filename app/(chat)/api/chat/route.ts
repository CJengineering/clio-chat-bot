import axios from 'axios';
import {
  convertToCoreMessages,
  generateObject,
  Message,
  StreamData,
  streamObject,
  streamText,
} from 'ai';

import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { customModel } from '@/ai';
import { models } from '@/ai/models';
import {
  canvasPrompt,
  jpalPrompt,
  jpalPromptV2,
  regularPrompt,
} from '@/ai/prompts';
import { auth } from '@/app/(auth)/auth';
import {
  deleteChatById,
  getChatById,
  getDocumentById,
  saveChat,
  saveDocument,
  saveSuggestions,
} from '@/db/queries';

import { Suggestion } from '@/db/schema';
import { generateUUID, sanitizeResponseMessages } from '@/lib/utils';

export const maxDuration = 60;

type AllowedTools =
  | 'createDocument'
  | 'updateDocument'
  | 'requestSuggestions'
  | 'getWeather';

const canvasTools: AllowedTools[] = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
];

const weatherTools: AllowedTools[] = ['getWeather'];

export async function POST(request: Request) {
  const {
    id,
    messages,
    modelId,
  }: { id: string; messages: Array<Message>; modelId: string } =
    await request.json();

  const session = await auth();

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  async function getGoogleAccessToken(): Promise<string> {
    const base64Encoded = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!base64Encoded) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS not provided');
    }
    const decodedJson = Buffer.from(base64Encoded, 'base64').toString('utf-8');
    const auth = new GoogleAuth({
      credentials: { project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY,
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID},
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (typeof tokenResponse !== 'string' && tokenResponse?.token) {
      return tokenResponse.token;
    } else if (typeof tokenResponse === 'string') {
      return tokenResponse;
    }

    throw new Error('Failed to obtain a valid access token');
  }

  async function fetchFromVertexAI(query: string): Promise<string> {
    const vertexEndpoint =
      'https://us-discoveryengine.googleapis.com/v1alpha/projects/100166227581/locations/us/collections/default_collection/engines/clio-test-v1_1736522116878/servingConfigs/default_search:search';
    const payload = {
      query,
      pageSize: 10,
      queryExpansionSpec: { condition: 'AUTO' },
      spellCorrectionSpec: { mode: 'AUTO' },
      contentSearchSpec: {
        extractiveContentSpec: { maxExtractiveAnswerCount: 1 },
      },
      session:
        'projects/100166227581/locations/us/collections/default_collection/engines/clio-test-v1_1736522116878/sessions/-',
    };

  

    try {
    
      const token = await getGoogleAccessToken();
      const response = await axios.post(vertexEndpoint, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;
      if (!data.results || data.results.length === 0) {
        return 'No relevant information found in the documents.';
      }

      const extractiveAnswers = data.results
        .flatMap(
          (result: any) =>
            result.document?.derivedStructData?.extractive_answers || []
        )
        .map((answer: any) => `Page ${answer.pageNumber}: ${answer.content}`)
        .join('\n');

      return (
        extractiveAnswers || 'No relevant information found in the documents.'
      );
    } catch (error) {
      console.error('Error querying Vertex AI:', error);
      return 'Error retrieving document-based answers.';
    }
  }

  const model = models.find((model) => model.id === modelId);

  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  const userMessage =
    messages.find((msg) => msg.role === 'user')?.content || '';
  let vertexAnswer = '';
  if (userMessage) {
    vertexAnswer = await fetchFromVertexAI(userMessage);
  }

  // Step 2: Add the Vertex AI response as context for ChatGPT
  const coreMessages = convertToCoreMessages([
    ...messages,
    {
      role: 'assistant',
      content: `Here is the document-based answer:\n${vertexAnswer}`,
    },
  ]);
  const streamingData = new StreamData();
  const prompt = jpalPromptV2(vertexAnswer);

  const result = await streamText({
    model: customModel(model.apiIdentifier),
    system: prompt,
    messages: coreMessages,
    maxSteps: 5,
    experimental_activeTools:
      modelId === 'gpt-4o-canvas' ? canvasTools : weatherTools,
    tools: {
      getWeather: {
        description: 'Get the current weather at a location',
        parameters: z.object({
          latitude: z.number(),
          longitude: z.number(),
        }),
        execute: async ({ latitude, longitude }) => {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
          );

          const weatherData = await response.json();
          return weatherData;
        },
      },
      createDocument: {
        description: 'Create a document for a writing activity',
        parameters: z.object({
          title: z.string(),
        }),
        execute: async ({ title }) => {
          const id = generateUUID();
          let draftText: string = '';

          streamingData.append({
            type: 'id',
            content: id,
          });

          streamingData.append({
            type: 'title',
            content: title,
          });

          streamingData.append({
            type: 'clear',
            content: '',
          });

          const { fullStream } = await streamText({
            model: customModel(model.apiIdentifier),
            system:
              'Write about the given topic. Markdown is supported. Use headings wherever appropriate.',
            prompt: title,
          });

          for await (const delta of fullStream) {
            const { type } = delta;

            if (type === 'text-delta') {
              const { textDelta } = delta;

              draftText += textDelta;
              streamingData.append({
                type: 'text-delta',
                content: textDelta,
              });
            }
          }

          streamingData.append({ type: 'finish', content: '' });

          if (session.user && session.user.id) {
            await saveDocument({
              id,
              title,
              content: draftText,
              userId: session.user.id,
            });
          }

          return {
            id,
            title,
            content: `A document was created and is now visible to the user.`,
          };
        },
      },
      updateDocument: {
        description: 'Update a document with the given description',
        parameters: z.object({
          id: z.string().describe('The ID of the document to update'),
          description: z
            .string()
            .describe('The description of changes that need to be made'),
        }),
        execute: async ({ id, description }) => {
          const document = await getDocumentById({ id });

          if (!document) {
            return {
              error: 'Document not found',
            };
          }

          const { content: currentContent } = document;
          let draftText: string = '';

          streamingData.append({
            type: 'clear',
            content: document.title,
          });

          const { fullStream } = await streamText({
            model: customModel(model.apiIdentifier),
            system:
              'You are a helpful writing assistant. Based on the description, please update the piece of writing.',
            messages: [
              {
                role: 'user',
                content: description,
              },
              { role: 'user', content: currentContent },
            ],
          });

          for await (const delta of fullStream) {
            const { type } = delta;

            if (type === 'text-delta') {
              const { textDelta } = delta;

              draftText += textDelta;
              streamingData.append({
                type: 'text-delta',
                content: textDelta,
              });
            }
          }

          streamingData.append({ type: 'finish', content: '' });

          if (session.user && session.user.id) {
            await saveDocument({
              id,
              title: document.title,
              content: draftText,
              userId: session.user.id,
            });
          }

          return {
            id,
            title: document.title,
            content: 'The document has been updated successfully.',
          };
        },
      },
      requestSuggestions: {
        description: 'Request suggestions for a document',
        parameters: z.object({
          documentId: z
            .string()
            .describe('The ID of the document to request edits'),
        }),
        execute: async ({ documentId }) => {
          const document = await getDocumentById({ id: documentId });

          if (!document || !document.content) {
            return {
              error: 'Document not found',
            };
          }

          let suggestions: Array<
            Omit<Suggestion, 'userId' | 'createdAt' | 'documentCreatedAt'>
          > = [];

          const { elementStream } = await streamObject({
            model: customModel(model.apiIdentifier),
            system:
              'You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words.',
            prompt: document.content,
            output: 'array',
            schema: z.object({
              originalSentence: z.string().describe('The original sentence'),
              suggestedSentence: z.string().describe('The suggested sentence'),
              description: z
                .string()
                .describe('The description of the suggestion'),
            }),
          });

          for await (const element of elementStream) {
            const suggestion = {
              originalText: element.originalSentence,
              suggestedText: element.suggestedSentence,
              description: element.description,
              id: generateUUID(),
              documentId: documentId,
              isResolved: false,
            };

            streamingData.append({
              type: 'suggestion',
              content: suggestion,
            });

            suggestions.push(suggestion);
          }

          if (session.user && session.user.id) {
            const userId = session.user.id;

            await saveSuggestions({
              suggestions: suggestions.map((suggestion) => ({
                ...suggestion,
                userId,
                createdAt: new Date(),
                documentCreatedAt: document.createdAt,
              })),
            });
          }

          return {
            id: documentId,
            title: document.title,
            message: 'Suggestions have been added to the document',
          };
        },
      },
    },
    onFinish: async ({ responseMessages }) => {
      if (session.user && session.user.id) {
        try {
          const responseMessagesWithoutIncompleteToolCalls =
            sanitizeResponseMessages(responseMessages);

          await saveChat({
            id,
            messages: [
              ...coreMessages,
              ...responseMessagesWithoutIncompleteToolCalls,
            ],
            userId: session.user.id,
          });
        } catch (error) {
          console.error('Failed to save chat');
        }
      }

      streamingData.close();
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'stream-text',
    },
  });

  return result.toDataStreamResponse({
    data: streamingData,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
