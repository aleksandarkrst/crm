import { useEffect, useMemo, useRef, useState } from 'react';
import { usePicker } from '../../components/ui';
import { COMMON_TIME_ZONES, allTimeZones, deviceTimeZone, timeZoneOption, zoneSections, type TimeZoneOption } from '../../lib/timeZones';

const labelOf = (z: TimeZoneOption) => (z.region ? `${z.city} (${z.region})` : z.city);

/**
 * Settings → General → Time zone (CD-488): a searchable list instead of 400 raw IANA ids. This
 * device's zone, the saved one and the region's common zones come first; each row shows today's
 * UTC offset; old names (Africa/Asmera) show as today's (Asmara). Type to search by city, region
 * or offset; arrows and Enter pick, Escape closes.
 */
export function TimeZonePicker({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (id: string) => void }) {
  const picker = usePicker();
  const all = useMemo(() => (picker.open ? allTimeZones() : []), [picker.open]);
  const sections = useMemo(() => zoneSections(all, picker.search, [deviceTimeZone() ?? '', value, ...COMMON_TIME_ZONES]), [all, picker.search, value]);
  const flat = sections.flatMap((s) => s.zones);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = timeZoneOption(value);

  useEffect(() => setActive(0), [picker.search, picker.open]);
  useEffect(() => {
    if (picker.open) searchRef.current?.focus();
  }, [picker.open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (id: string) => {
    picker.close();
    if (id !== value) onChange(id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, flat.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && flat[active]) pick(flat[active].id);
    else if (e.key === 'Escape') picker.close();
    else return;
    e.preventDefault();
  };

  let index = -1;
  return (
    <div ref={picker.ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button type="button" className="ghost tz-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={picker.open} aria-label="Time zone" data-testid="workspace-timezone" data-zone={value} onClick={() => (picker.open ? picker.close() : picker.setOpen(true))}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(current)}</span>
        <span className="tz-offset">{current.offset}</span>
      </button>
      {picker.open && (
        <div className="picker-pop tz-pop">
          <input ref={searchRef} className="form-input tz-search" value={picker.search} placeholder="Search a city, region or UTC+1" aria-label="Search time zones" aria-controls="tz-list" onChange={(e) => picker.setSearch(e.target.value)} onKeyDown={onKey} />
          <div id="tz-list" ref={listRef} role="listbox" aria-label="Time zones" className="tz-list">
            {sections.map((s) => (
              <div key={s.label} role="group" aria-label={s.label}>
                <div className="caps-muted tz-group">{s.label}</div>
                {s.zones.map((z) => {
                  index += 1;
                  const i = index;
                  return (
                    <div key={z.id} role="option" aria-selected={z.id === value} data-index={i} className={'picker-item tz-item' + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(z.id)}>
                      <span style={{ flex: 1, minWidth: 0 }}>{labelOf(z)}</span>
                      <span className="tz-offset">{z.offset}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {flat.length === 0 && <div className="tz-empty">No time zone matches "{picker.search.trim()}".</div>}
          </div>
        </div>
      )}
    </div>
  );
}
