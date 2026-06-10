import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  FileDiffIcon,
  FileTextIcon,
  type LucideIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  XIcon,
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
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/lib/use-media-query';

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

const WorkspacePanel = ({
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
    <>
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
    </>
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
const WORKSPACE_SIDEBAR_WIDTH = 256; // w-64
const MIN_CHAT_WIDTH = 480;

// Keep the artifact panel between its own bounds and whatever the viewport can
// spare without crushing the conversation column.
const clampArtifactWidth = (value: number) => {
  const available = window.innerWidth - WORKSPACE_SIDEBAR_WIDTH - MIN_CHAT_WIDTH;
  const max = Math.max(MIN_ARTIFACT_WIDTH, Math.min(MAX_ARTIFACT_WIDTH, available));
  return Math.min(max, Math.max(MIN_ARTIFACT_WIDTH, value));
};

const ArtifactPanel = ({
  path,
  dirty,
  version,
  closeIcon,
  closeLabel,
  onClose,
}: {
  path?: string;
  dirty: boolean;
  version: number;
  closeIcon: LucideIcon;
  closeLabel: string;
  onClose: () => void;
}) => {
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

  return (
    <Artifact className="h-full rounded-none border-none shadow-none">
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle className="truncate">
            {path ? path.split('/').pop() : 'Artifact'}
          </ArtifactTitle>
          <ArtifactDescription className="truncate text-xs" title={path}>
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
            icon={closeIcon}
            label={closeLabel}
            onClick={onClose}
            tooltip={closeLabel}
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
  );
};

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
  const [width, setWidth] = React.useState(() => clampArtifactWidth(420));

  React.useEffect(() => {
    const handleWindowResize = () => setWidth(clampArtifactWidth);
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    setWidth(clampArtifactWidth(window.innerWidth - event.clientX));
  };

  if (!open) {
    return (
      <aside className="flex shrink-0 flex-col items-center border-l p-1">
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
      className="relative flex shrink-0 flex-col overflow-hidden border-l"
      style={{ width }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-border"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        role="separator"
      />
      <ArtifactPanel
        closeIcon={PanelRightCloseIcon}
        closeLabel="Collapse"
        dirty={dirty}
        onClose={() => onOpenChange(false)}
        path={path}
        version={version}
      />
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
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = React.useState(false);
  const [artifactSheetOpen, setArtifactSheetOpen] = React.useState(false);
  // Pi wrote a file while the artifact UI wasn't visible (badge on the toggle).
  const [artifactUnseen, setArtifactUnseen] = React.useState(false);
  const isWorkspaceInline = useMediaQuery('(min-width: 768px)');
  const isArtifactInline = useMediaQuery('(min-width: 1024px)');
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
  // When the panel is an overlay (below lg) it would cover the conversation,
  // so only badge the toggle instead of opening it.
  const seenWritesRef = React.useRef(0);
  React.useEffect(() => {
    if (completedWrites.length > seenWritesRef.current && isBusy) {
      const written = completedWrites[completedWrites.length - 1];
      const relative = written.startsWith(`${workspace.root}/`)
        ? written.slice(workspace.root.length + 1)
        : written;
      setArtifactPath(relative);
      setArtifactVersion((previous) => previous + 1);
      if (isArtifactInline) {
        setArtifactOpen(true);
      } else {
        setArtifactUnseen(true);
      }
      refreshWorkspace();
    }
    seenWritesRef.current = completedWrites.length;
  }, [completedWrites, isBusy, workspace.root, refreshWorkspace, isArtifactInline]);

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

  const handleArtifactSheetOpenChange = (open: boolean) => {
    setArtifactSheetOpen(open);
    if (open) {
      setArtifactUnseen(false);
    }
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    if (filePaths.has(path)) {
      setArtifactPath(path);
      setArtifactVersion((previous) => previous + 1);
      if (isArtifactInline) {
        setArtifactOpen(true);
      } else {
        handleArtifactSheetOpenChange(true);
      }
      setWorkspaceSheetOpen(false);
    }
  };

  const artifactDirty = Boolean(artifactPath && gitStatus.files[artifactPath]);

  return (
    <div className="flex h-dvh">
      {isWorkspaceInline && (
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r">
          <WorkspacePanel
            git={gitStatus}
            onSelect={handleFileSelect}
            root={workspace.root}
            selectedPath={selectedFile}
            tree={workspace.files}
          />
        </aside>
      )}
      <div className="mx-auto flex h-full min-w-0 max-w-4xl flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {!isWorkspaceInline && (
              <Button
                onClick={() => setWorkspaceSheetOpen(true)}
                size="icon-sm"
                variant="ghost"
              >
                <PanelLeftIcon />
                <span className="sr-only">Show workspace</span>
              </Button>
            )}
            <div className="min-w-0">
              <h1 className="font-semibold text-sm">Pi ↔ AI SDK bridge</h1>
              <p className="truncate text-muted-foreground text-xs">
                Chat <code>{chatId}</code> · streaming from a live Pi coding agent
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border px-2.5 py-0.5 text-muted-foreground text-xs uppercase">
              {status}
            </span>
            {!isArtifactInline && (
              <Button
                className="relative"
                onClick={() => handleArtifactSheetOpenChange(true)}
                size="icon-sm"
                variant="ghost"
              >
                <PanelRightOpenIcon />
                {artifactUnseen && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" />
                )}
                <span className="sr-only">Show artifact</span>
              </Button>
            )}
          </div>
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
      {isArtifactInline ? (
        <ArtifactSidebar
          dirty={artifactDirty}
          onOpenChange={setArtifactOpen}
          open={artifactOpen}
          path={artifactPath}
          version={artifactVersion}
        />
      ) : (
        <Sheet onOpenChange={handleArtifactSheetOpenChange} open={artifactSheetOpen}>
          <SheetContent
            className="w-[90vw] gap-0 p-0 sm:max-w-xl"
            showCloseButton={false}
            side="right"
          >
            <SheetTitle className="sr-only">Artifact</SheetTitle>
            <SheetDescription className="sr-only">File preview</SheetDescription>
            <ArtifactPanel
              closeIcon={XIcon}
              closeLabel="Close"
              dirty={artifactDirty}
              onClose={() => handleArtifactSheetOpenChange(false)}
              path={artifactPath}
              version={artifactVersion}
            />
          </SheetContent>
        </Sheet>
      )}
      {!isWorkspaceInline && (
        <Sheet onOpenChange={setWorkspaceSheetOpen} open={workspaceSheetOpen}>
          <SheetContent className="gap-0 p-0" side="left">
            <SheetTitle className="sr-only">Workspace</SheetTitle>
            <SheetDescription className="sr-only">Project file tree</SheetDescription>
            <WorkspacePanel
              git={gitStatus}
              onSelect={handleFileSelect}
              root={workspace.root}
              selectedPath={selectedFile}
              tree={workspace.files}
            />
          </SheetContent>
        </Sheet>
      )}
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
