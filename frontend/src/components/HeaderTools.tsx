import { GlobalSearch } from './GlobalSearch';
import { NewMenu } from './NewMenu';

/** The right side of every screen's header: global search and the "New" menu. */
export function HeaderTools() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
      <GlobalSearch />
      <NewMenu />
    </div>
  );
}
