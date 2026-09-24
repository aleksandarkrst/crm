import { GlobalSearch } from './GlobalSearch';

/** The right side of every screen's header: global search. */
export function HeaderTools() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
      <GlobalSearch />
    </div>
  );
}
