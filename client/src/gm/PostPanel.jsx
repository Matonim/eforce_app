import { useState } from 'react';
import { Feed } from '../components/common.jsx';

const MAX = 280;

/** Race Control announcements: the GM's own posts in the shared paddock feed. */
export function PostPanel({ state, run }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const result = await run('gm:post', { text });
    setBusy(false);
    if (result) setText('');
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Paddock feed</h2>
        <span className="muted small">Everyone sees this: teams and the projector.</span>
      </div>
      <form className="form" onSubmit={submit}>
        <label className="form__label">
          Post as Race Control
          <textarea
            className="input"
            rows={2}
            maxLength={MAX}
            value={text}
            placeholder="Breaking: scrutineering opens in 10 minutes."
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="actions">
          <button className="button" type="submit" disabled={busy || !text.trim()}>
            Post
          </button>
          <span className="muted small">
            {text.length}/{MAX}
          </span>
        </div>
      </form>
      <Feed feed={state.match.feed} teams={state.match.teams} />
    </section>
  );
}
