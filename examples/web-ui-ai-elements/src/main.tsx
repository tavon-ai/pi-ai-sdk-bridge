import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { MessageSquareIcon } from 'lucide-react';
import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { SpeechInput } from '@/components/ai-elements/speech-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';

import './index.css';

const chatId = new URLSearchParams(location.search).get('id') ?? 'demo';
const api = import.meta.env.VITE_PI_BRIDGE_API ?? '/api/chat';
const transport = new DefaultChatTransport({ api });

const suggestions = [
  'List the files in this project.',
  'What does this project do?',
  'Say hello and explain what tools you can use.',
  'Show me the package.json and explain the scripts.',
  'Are there any TODO comments in the code?',
];

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((file) => (
        <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
};

function App() {
  const [input, setInput] = React.useState('');
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: chatId,
    transport,
  });
  const isBusy = status === 'submitted' || status === 'streaming';

  // Hydrate prior session history from the bridge (GET /api/chat/:id).
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${api}/${encodeURIComponent(chatId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<UIMessage[]>) : []))
      .then((history) => {
        if (!cancelled && history.length > 0) {
          setMessages((previous) => (previous.length > 0 ? previous : history));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text.trim());
    const hasAttachments = message.files.length > 0;
    if (!(hasText || hasAttachments) || isBusy) {
      return;
    }
    void sendMessage({ text: message.text, files: message.files });
    setInput('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isBusy) {
      return;
    }
    void sendMessage({ text: suggestion });
  };

  return (
    <div className="mx-auto flex h-dvh max-w-4xl flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="font-semibold text-sm">Pi ↔ AI SDK bridge</h1>
          <p className="text-muted-foreground text-xs">
            Chat <code>{chatId}</code> · streaming from a live Pi coding agent
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-0.5 text-muted-foreground text-xs uppercase">
          {status}
        </span>
      </header>

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Send a prompt and Pi will inspect this workspace with real tools."
              icon={<MessageSquareIcon className="size-8" />}
              title="Start a conversation with Pi"
            />
          ) : (
            messages.map((message, messageIndex) => (
              <MessageParts
                isLastMessage={messageIndex === messages.length - 1}
                key={message.id}
                message={message}
                status={status}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="grid shrink-0 gap-4 pt-4">
        {error && (
          <div className="mx-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {error.message}
          </div>
        )}
        <Suggestions className="px-4">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              onClick={() => handleSuggestionClick(suggestion)}
              suggestion={suggestion}
            />
          ))}
        </Suggestions>
        <div className="w-full px-4 pb-4">
          <PromptInput accept="image/*" globalDrop multiple onSubmit={handleSubmit}>
            <PromptInputHeader>
              <PromptInputAttachmentsDisplay />
            </PromptInputHeader>
            <PromptInputBody>
              <PromptInputTextarea
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask Pi to inspect or edit the workspace…"
                value={input}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Attach images" />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <SpeechInput
                  className="shrink-0"
                  onTranscriptionChange={(transcript) =>
                    setInput((previous) => (previous ? `${previous} ${transcript}` : transcript))
                  }
                  size="icon-sm"
                  variant="ghost"
                />
              </PromptInputTools>
              <PromptInputSubmit
                disabled={!isBusy && !input.trim()}
                onStop={stop}
                status={status}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

function MessageParts({
  message,
  isLastMessage,
  status,
}: {
  message: UIMessage;
  isLastMessage: boolean;
  status: 'submitted' | 'streaming' | 'ready' | 'error';
}) {
  const parts = message.parts;
  return (
    <>
      {parts.map((part, index) => {
        const isStreamingPart =
          isLastMessage && status === 'streaming' && index === parts.length - 1;

        switch (part.type) {
          case 'text':
            return (
              <Message from={message.role} key={`${message.id}-${index}`}>
                <MessageContent>
                  <MessageResponse>{part.text}</MessageResponse>
                </MessageContent>
              </Message>
            );

          case 'reasoning':
            return (
              <Reasoning
                className="w-full"
                isStreaming={isStreamingPart}
                key={`${message.id}-${index}`}
              >
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );

          case 'dynamic-tool':
            return (
              <Tool defaultOpen={part.state === 'output-error'} key={`${message.id}-${index}`}>
                <ToolHeader state={part.state} toolName={part.toolName} type="dynamic-tool" />
                <ToolContent>
                  <ToolInput input={part.input} />
                  <ToolOutput errorText={part.errorText} output={part.output} />
                </ToolContent>
              </Tool>
            );

          case 'file':
            return part.mediaType.startsWith('image/') ? (
              <Message from={message.role} key={`${message.id}-${index}`}>
                <MessageContent>
                  <img
                    alt={part.filename ?? 'attachment'}
                    className="max-h-64 rounded-md"
                    src={part.url}
                  />
                </MessageContent>
              </Message>
            ) : null;

          case 'step-start':
            return null;

          default:
            return null;
        }
      })}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
