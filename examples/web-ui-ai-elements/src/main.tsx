import React from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import './styles.css';

const chatId = new URLSearchParams(location.search).get('id') ?? 'demo';
const api = import.meta.env.VITE_PI_BRIDGE_API ?? '/api/chat';
const transport = new DefaultChatTransport({ api });

function App() {
  const [input, setInput] = React.useState('');
  const { messages, sendMessage, status, stop, error } = useChat({ id: chatId, transport });
  const isBusy = status !== 'ready' && status !== 'error';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    setInput('');
    await sendMessage({ text });
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Pi ↔ AI SDK bridge</p>
          <h1>Agent stream test bench</h1>
        </div>
        <div className="status" data-state={status}>{status}</div>
      </header>

      <section className="conversation">
        {messages.length === 0 ? (
          <div className="empty">
            <span>Try:</span>
            <button onClick={() => setInput('Say hello and explain what tools you can use.')}>hello + tools</button>
            <button onClick={() => setInput('List the files in this project.')}>list files</button>
          </div>
        ) : messages.map((message) => <MessageView key={message.id} message={message} />)}
      </section>

      {error && <div className="error">{error.message}</div>}

      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={isBusy ? 'Pi is streaming…' : 'Ask Pi to inspect or edit the workspace…'}
          rows={3}
          disabled={isBusy}
        />
        <div className="actions">
          {isBusy ? <button type="button" onClick={stop}>Stop</button> : <button type="submit">Send</button>}
        </div>
      </form>
    </main>
  );
}

function MessageView({ message }: { message: UIMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="role">{message.role}</div>
      <div className="parts">
        {message.parts.map((part, index) => {
          if (part.type === 'text') return <p key={index} className="text">{part.text}</p>;
          if (part.type === 'reasoning') return <details key={index} className="reasoning"><summary>reasoning</summary><pre>{part.text}</pre></details>;
          if (part.type === 'dynamic-tool') return <ToolPart key={index} part={part} />;
          if (part.type === 'step-start') return <div key={index} className="step">next step</div>;
          return <pre key={index} className="json">{JSON.stringify(part, null, 2)}</pre>;
        })}
      </div>
    </article>
  );
}

function ToolPart({ part }: { part: Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }> }) {
  return (
    <details className="tool" open>
      <summary>{part.toolName} <small>{part.state}</small></summary>
      {'input' in part && <pre>{JSON.stringify(part.input, null, 2)}</pre>}
      {'output' in part && <pre>{JSON.stringify(part.output, null, 2)}</pre>}
      {'errorText' in part && part.errorText && <pre className="toolError">{part.errorText}</pre>}
    </details>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
