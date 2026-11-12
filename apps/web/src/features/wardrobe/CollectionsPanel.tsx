import { useState, type FormEvent } from 'react';
import { SUGGESTED_COLLECTIONS, type CollectionListResponse, type WardrobeCollection } from '@fitvision/shared';
import { Alert, Button, Card, TextField } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';

interface Props {
  collections: WardrobeCollection[];
  onChange: (collections: WardrobeCollection[]) => void;
  onOpen: (collection: WardrobeCollection) => void;
}

/** Manual outfit groups (Work, Casual, …). No automatic styling. */
export function CollectionsPanel({ collections, onChange, onOpen }: Props) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<CollectionListResponse>) {
    setError(null);
    try {
      onChange((await fn()).collections);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      return false;
    }
  }

  const create = (n: string) => run(() => apiFetch<CollectionListResponse>('/collections', { method: 'POST', body: { name: n } }));

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (await create(name)) setName('');
  }

  const suggestions = SUGGESTED_COLLECTIONS.filter((s) => !collections.some((c) => c.name.toLowerCase() === s.toLowerCase()));

  return (
    <div className="fv-stack">
      {error && <Alert tone="error">{error}</Alert>}
      <Card className="fv-stack">
        <form className="fv-inline-form" onSubmit={onCreate} noValidate>
          <TextField label="New collection" placeholder="e.g. Work" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <Button type="submit" disabled={!name.trim()}>
            Create
          </Button>
        </form>
        {suggestions.length > 0 && (
          <div className="fv-row-wrap" aria-label="Suggested collections">
            {suggestions.map((s) => (
              <Button key={s} variant="secondary" className="fv-btn--sm" onClick={() => create(s)}>
                + {s}
              </Button>
            ))}
          </div>
        )}
      </Card>
      {collections.length === 0 ? (
        <Card className="fv-empty">
          <p className="fv-muted">No collections yet. Create one, then add clothing to it from My clothing.</p>
        </Card>
      ) : (
        <ul className="fv-collection-list">
          {collections.map((c) => (
            <li key={c.id}>
              <Card className="fv-collection">
                {editing?.id === c.id ? (
                  <form
                    className="fv-inline-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run(() => apiFetch<CollectionListResponse>(`/collections/${c.id}`, { method: 'PATCH', body: { name: editing.name } }))) setEditing(null);
                    }}
                  >
                    <TextField label={`Rename ${c.name}`} value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} maxLength={40} />
                    <Button type="submit">Save</Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <div>
                      <h3>{c.name}</h3>
                      <p className="fv-muted fv-small">
                        {c.productIds.length} item{c.productIds.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="fv-row-wrap">
                      <Button variant="secondary" className="fv-btn--sm" onClick={() => onOpen(c)}>
                        View
                      </Button>
                      <Button variant="ghost" className="fv-btn--sm" onClick={() => setEditing({ id: c.id, name: c.name })}>
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        className="fv-btn--sm"
                        onClick={() => {
                          if (window.confirm(`Delete the collection “${c.name}”? The clothing in it is kept.`)) {
                            void run(async () => {
                              await apiFetch(`/collections/${c.id}`, { method: 'DELETE' });
                              return apiFetch<CollectionListResponse>('/collections');
                            });
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
