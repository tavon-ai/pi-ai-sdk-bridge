import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  FileDiffIcon,
  FileTextIcon,
  MessageSquareIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from 'lucide-react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { BundledLanguage } from 'shiki';

import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact';
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import { CodeBlock } from '@/components/ai-elements/code-block';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from '@/components/ai-elements/file-tree';
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

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

type GitStatus = {
  repo: boolean;
  branch: string | null;
  files: Record<string, GitFileStatus>;
};

const DirtyDot = ({ title }: { title?: string }) => (
  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" title={title} />
);

// Directories containing at least one dirty file, so they can carry a dot too.
const collectDirtyDirs = (gitFiles: Record<string, GitFileStatus>) => {
  const dirs = new Set<string>();
  for (const path of Object.keys(gitFiles)) {
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      dirs.add(segments.slice(0, depth).join('/'));
    }
  }
  return dirs;
};

const renderTreeNodes = (
  nodes: FileTreeNode[],
  gitFiles: Record<string, GitFileStatus>,
  dirtyDirs: Set<string>,
) =>
  nodes.map((node) =>
    node.type === 'directory' ? (
      <FileTreeFolder
        badge={dirtyDirs.has(node.path) ? <DirtyDot /> : undefined}
        key={node.path}
        name={node.name}
        path={node.path}
      >
        {renderTreeNodes(node.children ?? [], gitFiles, dirtyDirs)}
      </FileTreeFolder>
    ) : (
      <FileTreeFile
        badge={gitFiles[node.path] ? <DirtyDot title={gitFiles[node.path]} /> : undefined}
        key={node.path}
        name={node.name}
        path={node.path}
      />
    ),
  );

const collectFilePaths = (nodes: FileTreeNode[], into: Set<string>) => {
  for (const node of nodes) {
    if (node.type === 'file') {
      into.add(node.path);
    } else {
      collectFilePaths(node.children ?? [], into);
    }
  }
  return into;
};

const WorkspaceSidebar = ({
  root,
  tree,
  git,
  selectedPath,
  onSelect,
}: {
  root: string;
  tree: FileTreeNode[];
  git: GitStatus;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) => {
  const dirtyDirs = React.useMemo(() => collectDirtyDirs(git.files), [git.files]);

  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r md:flex">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold text-sm">
          Workspace
          {git.branch && (
            <span className="ml-2 font-normal text-muted-foreground text-xs">{git.branch}</span>
          )}
        </h2>
        <p className="truncate text-muted-foreground text-xs" title={root}>
          {root}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <FileTree
          className="border-none"
          defaultExpanded={new Set(['src'])}
          onSelect={onSelect}
          selectedPath={selectedPath}
        >
          {renderTreeNodes(tree, git.files, dirtyDirs)}
        </FileTree>
      </div>
    </aside>
  );
};

const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  svg: 'xml',
  xml: 'xml',
};

const languageForPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  // 'text' is one of shiki's built-in plain languages, just not part of the BundledLanguage union.
  return EXTENSION_LANGUAGES[extension] ?? ('text' as BundledLanguage);
};

const MIN_ARTIFACT_WIDTH = 280;
const MAX_ARTIFACT_WIDTH = 800;

const ArtifactSidebar = ({
  path,
  dirty,
  version,
  open,
  onOpenChange,
}: {
  path?: string;
  dirty: boolean;
  version: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [width, setWidth] = React.useState(420);
  const [view, setView] = React.useState<'file' | 'diff'>('file');
  const [content, setContent] = React.useState<string>();
  const [loadError, setLoadError] = React.useState<string>();

  // A newly opened file always starts in file view.
  React.useEffect(() => {
    setView('file');
  }, [path]);

  const effectiveView = view === 'diff' && dirty ? 'diff' : 'file';

  React.useEffect(() => {
    if (!path) {
      return;
    }
    let cancelled = false;
    setLoadError(undefined);

    const request =
      effectiveView === 'diff'
        ? fetch(`/api/workspace/git/diff?path=${encodeURIComponent(path)}`).then(
            async (response) => {
              if (!response.ok) throw new Error(`Could not load diff for ${path}`);
              const { diff } = (await response.json()) as { diff: string };
              return diff;
            },
          )
        : fetch(`/api/workspace/files/content?path=${encodeURIComponent(path)}`).then(
            async (response) => {
              if (!response.ok) throw new Error(`Could not load ${path}`);
              const body = (await response.json()) as {
                content: string | null;
                binary: boolean;
                truncated: boolean;
              };
              if (body.binary) throw new Error('Binary file — no preview.');
              return body.truncated ? `${body.content}\n… (truncated)` : (body.content ?? '');
            },
          );

    request
      .then((text) => {
        if (!cancelled) {
          setContent(text);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setContent(undefined);
          setLoadError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, version, effectiveView]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    setWidth(
      Math.min(MAX_ARTIFACT_WIDTH, Math.max(MIN_ARTIFACT_WIDTH, window.innerWidth - event.clientX)),
    );
  };

  if (!open) {
    return (
      <aside className="hidden shrink-0 flex-col items-center border-l p-1 md:flex">
        <ArtifactAction
          icon={PanelRightOpenIcon}
          label="Show artifact"
          onClick={() => onOpenChange(true)}
          tooltip={path ?? 'Show artifact'}
        />
      </aside>
    );
  }

  return (
    <aside
      className="relative hidden shrink-0 flex-col overflow-hidden border-l md:flex"
      style={{ width }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-border"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        role="separator"
      />
      <Artifact className="h-full rounded-none border-none shadow-none">
        <ArtifactHeader>
          <div className="min-w-0">
            <ArtifactTitle className="truncate">
              {path ? path.split('/').pop() : 'Artifact'}
            </ArtifactTitle>
            <ArtifactDescription className="truncate" title={path}>
              {path ?? 'No file open'}
            </ArtifactDescription>
          </div>
          <ArtifactActions>
            {dirty && (
              <ArtifactAction
                icon={effectiveView === 'diff' ? FileTextIcon : FileDiffIcon}
                label={effectiveView === 'diff' ? 'Show file' : 'Show diff'}
                onClick={() => setView(effectiveView === 'diff' ? 'file' : 'diff')}
                tooltip={effectiveView === 'diff' ? 'Show file' : 'Show diff'}
              />
            )}
            <ArtifactAction
              icon={PanelRightCloseIcon}
              label="Collapse"
              onClick={() => onOpenChange(false)}
              tooltip="Collapse"
            />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent className="p-0">
          {!path ? (
            <div className="flex h-full items-center justify-center p-4">
              <p className="text-center text-muted-foreground text-sm">
                Select a file on the left or let Pi create one in the chat.
              </p>
            </div>
          ) : loadError ? (
            <p className="p-4 text-muted-foreground text-sm">{loadError}</p>
          ) : content !== undefined ? (
            <CodeBlock
              className="rounded-none border-none"
              code={content}
              language={effectiveView === 'diff' ? 'diff' : languageForPath(path)}
              showLineNumbers={effectiveView === 'file'}
            />
          ) : (
            <p className="p-4 text-muted-foreground text-sm">Loading…</p>
          )}
        </ArtifactContent>
      </Artifact>
    </aside>
  );
};

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
  const [selectedFile, setSelectedFile] = React.useState<string>();
  const [workspace, setWorkspace] = React.useState<{ root: string; files: FileTreeNode[] }>({
    root: '',
    files: [],
  });
  const [gitStatus, setGitStatus] = React.useState<GitStatus>({
    repo: false,
    branch: null,
    files: {},
  });
  const [artifactPath, setArtifactPath] = React.useState<string>();
  const [artifactOpen, setArtifactOpen] = React.useState(false);
  const [artifactVersion, setArtifactVersion] = React.useState(0);
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: chatId,
    transport,
  });
  const isBusy = status === 'submitted' || status === 'streaming';

  const filePaths = React.useMemo(
    () => collectFilePaths(workspace.files, new Set<string>()),
    [workspace.files],
  );

  const refreshWorkspace = React.useCallback(() => {
    fetch('/api/workspace/files')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ root: string; files: FileTreeNode[] }>)
          : { root: '', files: [] },
      )
      .then(setWorkspace)
      .catch(() => undefined);
    fetch('/api/workspace/git/status')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<GitStatus>)
          : { repo: false, branch: null, files: {} },
      )
      .then(setGitStatus)
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    refreshWorkspace();
  }, [refreshWorkspace]);

  // Paths of every completed write/edit tool call, in conversation order.
  const completedWrites = React.useMemo(() => {
    const writes: string[] = [];
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type === 'dynamic-tool' &&
          part.state === 'output-available' &&
          (part.toolName === 'write' || part.toolName === 'edit')
        ) {
          const path = (part.input as { path?: string } | undefined)?.path;
          if (path) {
            writes.push(path);
          }
        }
      }
    }
    return writes;
  }, [messages]);

  // Open files Pi creates or edits in the artifact panel as they happen. The
  // status guard keeps hydrated history from popping the panel open on load.
  const seenWritesRef = React.useRef(0);
  React.useEffect(() => {
    if (completedWrites.length > seenWritesRef.current && isBusy) {
      const written = completedWrites[completedWrites.length - 1];
      const relative = written.startsWith(`${workspace.root}/`)
        ? written.slice(workspace.root.length + 1)
        : written;
      setArtifactPath(relative);
      setArtifactOpen(true);
      setArtifactVersion((previous) => previous + 1);
      refreshWorkspace();
    }
    seenWritesRef.current = completedWrites.length;
  }, [completedWrites, isBusy, workspace.root, refreshWorkspace]);

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

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    if (filePaths.has(path)) {
      setArtifactPath(path);
      setArtifactOpen(true);
      setArtifactVersion((previous) => previous + 1);
    }
  };

  return (
    <div className="flex h-dvh">
      <WorkspaceSidebar
        git={gitStatus}
        onSelect={handleFileSelect}
        root={workspace.root}
        selectedPath={selectedFile}
        tree={workspace.files}
      />
      <div className="mx-auto flex h-full min-w-0 max-w-4xl flex-1 flex-col">
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
      <ArtifactSidebar
        dirty={Boolean(artifactPath && gitStatus.files[artifactPath])}
        onOpenChange={setArtifactOpen}
        open={artifactOpen}
        path={artifactPath}
        version={artifactVersion}
      />
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
