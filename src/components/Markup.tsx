import { Fragment, useState, type ReactNode } from 'react';
import { glossary } from '../content';

/**
 * Renders lesson text: blank line = paragraph, "- " bullets, "1. " numbered lists,
 * **bold**, and [[term]] glossary links that open a definition.
 */
export function Markup({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="markup">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^- /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}><Inline text={l.slice(2)} /></li>)}</ul>;
        if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\d+\. /, '')} /></li>)}</ol>;
        // Mixed: a lead line followed by a list.
        const firstList = lines.findIndex((l) => /^(- |\d+\. )/.test(l));
        if (firstList > 0) {
          const head = lines.slice(0, firstList).join(' ');
          const rest = lines.slice(firstList);
          const numbered = /^\d+\. /.test(rest[0]);
          const items = rest.map((l) => l.replace(/^(- |\d+\. )/, ''));
          return (
            <Fragment key={i}>
              <p><Inline text={head} /></p>
              {numbered ? <ol>{items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ol> : <ul>{items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>}
            </Fragment>
          );
        }
        return <p key={i}><Inline text={lines.join(' ')} /></p>;
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else out.push(<Term key={k++} term={tok.slice(2, -2)} />);
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Term({ term }: { term: string }) {
  const [open, setOpen] = useState(false);
  const def = glossary[term];
  return (
    <span className="term-wrap">
      <button type="button" className="term" aria-expanded={open} onClick={() => setOpen(!open)}>
        {term}
      </button>
      {open && (
        <span className="term-def" role="note">
          <strong>{term}:</strong> {def ?? 'No definition yet.'}{' '}
          <button type="button" className="term-close" onClick={() => setOpen(false)} aria-label="Close definition">✕</button>
        </span>
      )}
    </span>
  );
}
