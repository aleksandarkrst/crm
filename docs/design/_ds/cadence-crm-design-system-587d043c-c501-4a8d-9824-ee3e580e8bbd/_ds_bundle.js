/* @ds-bundle: {"format":4,"namespace":"CadenceCRMDesignSystem_587d04","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Tag","sourcePath":"components/core/Badge.jsx"},{"name":"FitScore","sourcePath":"components/core/Badge.jsx"},{"name":"ChannelChip","sourcePath":"components/core/Badge.jsx"},{"name":"Kbd","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"ICON_PATHS","sourcePath":"components/core/iconPaths.js"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"EmptyDashed","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"},{"name":"ModalHeader","sourcePath":"components/feedback/Modal.jsx"},{"name":"ModalActions","sourcePath":"components/feedback/Modal.jsx"},{"name":"HintBox","sourcePath":"components/feedback/Modal.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Choice","sourcePath":"components/forms/Choice.jsx"},{"name":"ChoicePill","sourcePath":"components/forms/Choice.jsx"},{"name":"FieldRow","sourcePath":"components/forms/FieldRow.jsx"},{"name":"FormField","sourcePath":"components/forms/FormField.jsx"},{"name":"GhostInput","sourcePath":"components/forms/GhostInput.jsx"},{"name":"GhostSelect","sourcePath":"components/forms/GhostSelect.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"TaskCheck","sourcePath":"components/forms/TaskCheck.jsx"},{"name":"FilterBar","sourcePath":"components/navigation/FilterBar.jsx"},{"name":"Menu","sourcePath":"components/navigation/Menu.jsx"},{"name":"MenuItem","sourcePath":"components/navigation/Menu.jsx"},{"name":"MenuLabel","sourcePath":"components/navigation/Menu.jsx"},{"name":"MenuDivider","sourcePath":"components/navigation/Menu.jsx"},{"name":"SearchTrigger","sourcePath":"components/navigation/SearchTrigger.jsx"},{"name":"SortHeader","sourcePath":"components/navigation/SortHeader.jsx"},{"name":"TableHead","sourcePath":"components/navigation/SortHeader.jsx"},{"name":"TableRow","sourcePath":"components/navigation/SortHeader.jsx"},{"name":"StageBar","sourcePath":"components/navigation/StageBar.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"a05eb7a9674d","components/core/Badge.jsx":"688e38326c0d","components/core/Button.jsx":"0fee06e37248","components/core/Card.jsx":"5ad9ca7bfc53","components/core/Icon.jsx":"0e43172a257c","components/core/IconButton.jsx":"410e5286a7c8","components/core/Logo.jsx":"3ec9fd14fee3","components/core/iconPaths.js":"153aad4e438a","components/feedback/EmptyState.jsx":"207315511b2b","components/feedback/Modal.jsx":"103b6e6aa814","components/feedback/Toast.jsx":"32152c158679","components/forms/Choice.jsx":"39c22147f815","components/forms/FieldRow.jsx":"3d7ba812f2ee","components/forms/FormField.jsx":"80828d5d7ebe","components/forms/GhostInput.jsx":"8df9e0c9aeec","components/forms/GhostSelect.jsx":"69396cc59ac5","components/forms/Switch.jsx":"c0dd071592a4","components/forms/TaskCheck.jsx":"793b404a8c89","components/navigation/FilterBar.jsx":"64b949d67a01","components/navigation/Menu.jsx":"0ee40312b9f2","components/navigation/SearchTrigger.jsx":"f7c37a8c88ff","components/navigation/SortHeader.jsx":"bb0ac563dbd5","components/navigation/StageBar.jsx":"83e056f59a14","ui_kits/crm/CompaniesScreen.jsx":"be852ea50f51","ui_kits/crm/DealScreen.jsx":"208cb0b74f4a","ui_kits/crm/PipelineScreen.jsx":"9032ab662b6c","ui_kits/crm/ScreenHeader.jsx":"dc19d702190c","ui_kits/crm/Sidebar.jsx":"4fea87b306cb","ui_kits/crm/TodayScreen.jsx":"885b6bafa6f3","ui_kits/crm/data.js":"7d1477e9d073"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CadenceCRMDesignSystem_587d04 = window.CadenceCRMDesignSystem_587d04 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function Avatar({
  initials,
  size = 26,
  font = 10,
  square = false,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "avatar",
    style: {
      width: size,
      height: size,
      fontSize: font,
      flex: '0 0 ' + size + 'px',
      ...(square ? {
        borderRadius: 6,
        background: 'var(--segment)',
        color: 'var(--text-2)'
      } : {}),
      ...style
    }
  }, initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function Badge({
  tone = 'neutral',
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'badge badge-' + tone,
    style: style
  }, children);
}
function Tag({
  children,
  bg = 'var(--brand-soft)',
  color = 'var(--brand)'
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "tag",
    style: {
      background: bg,
      color
    }
  }, children);
}
function FitScore({
  score
}) {
  const bg = score >= 80 ? '#E7F2EE' : score >= 65 ? '#FDF0E4' : '#F2F5F3';
  const fg = score >= 80 ? '#14503C' : score >= 65 ? '#B4531B' : '#475750';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      padding: '3px 5px',
      borderRadius: 4,
      background: bg,
      color: fg
    }
  }, "fit ", score);
}
function ChannelChip({
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 500,
      background: 'var(--ink)',
      color: 'var(--white)',
      padding: '4px 9px',
      borderRadius: 6,
      whiteSpace: 'nowrap'
    }
  }, children);
}
function Kbd({
  children
}) {
  return /*#__PURE__*/React.createElement("kbd", {
    className: "kbd"
  }, children);
}
Object.assign(__ds_scope, { Badge, Tag, FitScore, ChannelChip, Kbd });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const CLS = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  disabled: 'btn btn-disabled',
  won: 'btn btn-won',
  lost: 'btn btn-lost',
  outline: 'btn-outline',
  plain: 'btn-plain',
  dashed: 'btn-dashed'
};
function Button({
  variant = 'primary',
  children,
  onClick,
  disabled,
  type = 'button',
  style,
  title
}) {
  if (variant === 'danger') return /*#__PURE__*/React.createElement("button", {
    type: type,
    title: title,
    onClick: onClick,
    style: {
      cursor: 'pointer',
      border: '1px solid var(--border)',
      background: 'var(--white)',
      color: 'var(--danger)',
      fontSize: 12,
      padding: '6px 11px',
      borderRadius: 6,
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
  const v = disabled && (variant === 'primary' || variant === 'secondary') ? 'disabled' : variant;
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    title: title,
    className: CLS[v] || CLS.primary,
    onClick: onClick,
    disabled: disabled,
    style: style
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  children,
  pad = true,
  title,
  sub,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: pad ? 'card card-pad' : 'card',
    style: style
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: sub ? 2 : 12
    },
    className: "card-title"
  }, title), sub && /*#__PURE__*/React.createElement("div", {
    className: "card-sub",
    style: {
      marginBottom: 12
    }
  }, sub), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
function Logo({
  height = 28,
  onDark = false,
  wordmark = true,
  style
}) {
  const panel = onDark ? '#FFFFFF' : '#0D241C',
    bars = onDark ? '#0D241C' : '#FFFFFF';
  const markH = height,
    showWord = wordmark && height * 3.1 >= 88;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: height * 0.32,
      color: panel,
      ...style
    },
    "aria-label": "pultly"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 48",
    height: markH,
    width: markH * 64 / 48,
    fill: "none",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 4h48L52 34H4z",
    fill: panel
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 28h5l2.7-8h-5z",
    fill: bars
  }), /*#__PURE__*/React.createElement("path", {
    d: "M28 28h5l4-12h-5z",
    fill: bars
  }), /*#__PURE__*/React.createElement("path", {
    d: "M36 28h5l5.3-16h-5z",
    fill: "#C6F16A"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "39",
    width: "36",
    height: "5",
    rx: "2.5",
    fill: panel
  })), showWord && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      letterSpacing: '-0.04em',
      fontSize: height * 0.92,
      lineHeight: 1,
      textTransform: 'lowercase'
    }
  }, "pultly"));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/iconPaths.js
try { (() => {
// Stroke paths (24×24) copied verbatim from frontend/src/components/{icons.tsx,commands.ts,Layout.tsx}.
const P = {
  "overview": "M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6",
  "pipeline": "M4 5h5v14H4zM15 5h5v9h-5z",
  "today": "M5 5h14v14H5zM9 12l2 2 4-4",
  "company": "M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1",
  "contact": "M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7",
  "product": "M20 8.5 12 4 4 8.5v7L12 20l8-4.5v-7ZM4 8.5 12 13m0 0 8-4.5M12 13v7",
  "settings": "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.5-2-1.5Z",
  "value": "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  "contacts": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  "calendar": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "funnel": "M3 4h18l-7 8.5V20l-4-2v-5.5z",
  "source": "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  "building": "M4 21V5l8-2v18M12 8h8v13M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01M2 21h20",
  "industry": "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  "location": "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  "team": "M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1",
  "owner": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a7 7 0 0 1 16 0v1",
  "mail": "M4 6h16v12H4zM4 7l8 6 8-6",
  "phone": "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z",
  "note": "M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h3",
  "pencil": "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  "document": "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  "bell": "M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10 19.5a2 2 0 0 0 4 0",
  "logout": "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  "search": "M20 20l-4.2-4.2M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
  "plus": "M12 5v14M5 12h14",
  "x": "M6 6l12 12M18 6L6 18",
  "check": "m5 12.5 4.5 4.5L19 7.5",
  "more": "M5 12h.01M12 12h.01M19 12h.01"
};
P.deal = P.value;
P.task = P.today;
const ICON_PATHS = P;
Object.assign(__ds_scope, { ICON_PATHS });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/iconPaths.js", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function Icon({
  name,
  size = 16,
  stroke = 1.7,
  color,
  title
}) {
  const d = __ds_scope.ICON_PATHS[name] || '';
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: title ? 'img' : undefined,
    "aria-label": title,
    "aria-hidden": title ? undefined : true,
    style: {
      flex: '0 0 auto'
    }
  }, title && /*#__PURE__*/React.createElement("title", null, title), /*#__PURE__*/React.createElement("path", {
    d: d
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function IconButton({
  icon = 'x',
  variant = 'remove',
  onClick,
  title,
  badge,
  size,
  box,
  active
}) {
  if (variant === 'round' || variant === 'ghost-round') {
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      title: title,
      "aria-label": title,
      "aria-expanded": active || undefined,
      className: variant === 'round' ? 'round-btn' : 'icon-round',
      onClick: onClick
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: icon,
      size: size || (variant === 'round' ? 17 : 18),
      stroke: variant === 'round' ? 2.2 : 1.7
    }), !!badge && /*#__PURE__*/React.createElement("span", {
      className: "dot-badge"
    }, badge > 9 ? '9+' : badge));
  }
  const b = box || 26;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "icon-btn",
    title: title || 'Remove',
    onClick: onClick,
    style: {
      width: b,
      height: b
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size || 15,
    stroke: 2
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function EmptyState({
  title,
  text,
  action,
  sample,
  onAction,
  onSample
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty-block"
  }, /*#__PURE__*/React.createElement("span", {
    className: "empty-block-title"
  }, title), /*#__PURE__*/React.createElement("span", {
    className: "empty-block-text"
  }, text), /*#__PURE__*/React.createElement("div", {
    className: "empty-block-actions"
  }, action && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn btn-primary",
    onClick: onAction
  }, action), sample && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn-outline",
    onClick: onSample
  }, "Or load sample data")));
}
function EmptyDashed({
  children = 'Drop a deal here'
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty-dashed"
  }, children);
}
Object.assign(__ds_scope, { EmptyState, EmptyDashed });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Modal.jsx
try { (() => {
function Modal({
  children,
  maxWidth = 520,
  gap = 16,
  onBackdrop,
  inline
}) {
  const box = /*#__PURE__*/React.createElement("div", {
    className: "modal",
    style: {
      maxWidth,
      gap
    },
    onClick: e => e.stopPropagation()
  }, children);
  if (inline) return box;
  return /*#__PURE__*/React.createElement("div", {
    className: "overlay",
    onClick: onBackdrop
  }, box);
}
function ModalHeader({
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "modal-title"
  }, title), sub && /*#__PURE__*/React.createElement("div", {
    className: "modal-sub"
  }, sub));
}
function ModalActions({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "modal-actions"
  }, children);
}
function HintBox({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "hint-box"
  }, children);
}
Object.assign(__ds_scope, { Modal, ModalHeader, ModalActions, HintBox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Modal.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function Toast({
  children,
  inline
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "toast",
    style: inline ? {
      position: 'static',
      transform: 'none',
      display: 'inline-block'
    } : undefined
  }, children);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Choice.jsx
try { (() => {
function Choice({
  on,
  title,
  desc,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: on ? 'choice on' : 'choice',
    onClick: onClick
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--ink)'
    }
  }, title), desc && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-2)',
      lineHeight: 1.45
    }
  }, desc));
}
function ChoicePill({
  on,
  children,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: on ? 'choice-pill on' : 'choice-pill',
    onClick: onClick
  }, children);
}
Object.assign(__ds_scope, { Choice, ChoicePill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Choice.jsx", error: String((e && e.message) || e) }); }

// components/forms/FieldRow.jsx
try { (() => {
function FieldRow({
  label,
  icon,
  children
}) {
  if (icon) return /*#__PURE__*/React.createElement("div", {
    className: "field-row icon-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "icon-row-icon",
    title: label
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    title: label
  })), children);
  return /*#__PURE__*/React.createElement("div", {
    className: "field-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "field-label"
  }, label), children);
}
Object.assign(__ds_scope, { FieldRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FieldRow.jsx", error: String((e && e.message) || e) }); }

// components/forms/FormField.jsx
try { (() => {
function FormField({
  label,
  children,
  placeholder,
  value,
  defaultValue,
  onChange,
  multiline,
  box,
  type = 'text'
}) {
  const cls = box ? 'box-input' : 'form-input';
  const control = children || (multiline ? /*#__PURE__*/React.createElement("textarea", {
    className: cls,
    rows: 3,
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange
  }) : /*#__PURE__*/React.createElement("input", {
    className: cls,
    type: type,
    placeholder: placeholder,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange
  }));
  if (!label) return control;
  return /*#__PURE__*/React.createElement("label", {
    className: "form-label"
  }, label, control);
}
Object.assign(__ds_scope, { FormField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FormField.jsx", error: String((e && e.message) || e) }); }

// components/forms/GhostInput.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function GhostInput({
  small,
  className = '',
  ...props
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    className: 'ghost ' + (small ? 'ghost-sm ' : '') + className
  }, props));
}
Object.assign(__ds_scope, { GhostInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/GhostInput.jsx", error: String((e && e.message) || e) }); }

// components/forms/GhostSelect.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Chevron() {
  return /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 4.5 6 8l3.5-3.5"
  }));
}
function GhostSelect({
  options = [],
  chevron = true,
  className = '',
  ...props
}) {
  const sel = /*#__PURE__*/React.createElement("select", _extends({
    className: 'ghost ' + className
  }, props), options.map(o => {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  }));
  if (!chevron) return sel;
  return /*#__PURE__*/React.createElement("div", {
    className: "select-wrap"
  }, sel, /*#__PURE__*/React.createElement("span", {
    className: "chev"
  }, /*#__PURE__*/React.createElement(Chevron, null)));
}
Object.assign(__ds_scope, { GhostSelect });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/GhostSelect.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  on,
  onClick,
  label
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: on ? 'switch on' : 'switch',
    onClick: onClick,
    role: "switch",
    "aria-checked": !!on,
    "aria-label": label
  }, /*#__PURE__*/React.createElement("span", null));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/TaskCheck.jsx
try { (() => {
function TaskCheck({
  done,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: done ? 'Reopen' : 'Mark done',
    onClick: onClick,
    style: {
      flex: '0 0 19px',
      width: 19,
      height: 19,
      borderRadius: 6,
      border: '1px solid ' + (done ? '#14503C' : '#CAD3CE'),
      background: done ? '#14503C' : '#FFFFFF',
      color: '#FFFFFF',
      fontSize: 11,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0
    }
  }, done ? '✓' : '');
}
Object.assign(__ds_scope, { TaskCheck });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TaskCheck.jsx", error: String((e && e.message) || e) }); }

// components/navigation/FilterBar.jsx
try { (() => {
function FilterBar({
  search,
  chips = [],
  dirty,
  onClear,
  meta,
  action,
  extra
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "filter-bar",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 16
    }
  }, search && /*#__PURE__*/React.createElement("div", {
    className: "filter-search",
    style: {
      display: 'flex',
      alignItems: 'center',
      background: 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 11px',
      width: 230
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: search.value,
    onChange: e => search.onChange && search.onChange(e.target.value),
    placeholder: search.placeholder,
    style: {
      border: 0,
      outline: 0,
      background: 'transparent',
      fontSize: 13,
      width: '100%',
      color: 'var(--ink)'
    }
  })), chips.map((c, i) => /*#__PURE__*/React.createElement("select", {
    key: i,
    value: c.value,
    onChange: e => c.onChange && c.onChange(e.target.value),
    style: {
      border: '1px solid var(--border)',
      background: 'var(--white)',
      borderRadius: 8,
      padding: '9px 11px',
      fontSize: 13,
      color: 'var(--ink)'
    }
  }, c.options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o)))), dirty && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn btn-secondary",
    onClick: onClear,
    style: {
      padding: '9px 13px'
    }
  }, "Clear filters"), /*#__PURE__*/React.createElement("div", {
    className: "filter-actions",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginLeft: 'auto'
    }
  }, meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-2)',
      whiteSpace: 'nowrap'
    }
  }, meta), extra, action && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn btn-primary",
    onClick: action.onClick
  }, action.label)));
}
Object.assign(__ds_scope, { FilterBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/FilterBar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Menu.jsx
try { (() => {
function Menu({
  children,
  width = 230,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "menu-pop",
    role: "menu",
    style: {
      position: 'relative',
      top: 0,
      width,
      ...style
    }
  }, children);
}
function MenuItem({
  icon,
  label,
  sub,
  shortcut,
  active,
  onClick,
  color
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "menuitem",
    className: active ? 'menu-item active' : 'menu-item',
    onClick: onClick
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 18
  })), /*#__PURE__*/React.createElement("span", {
    className: "menu-item-title",
    style: color ? {
      color
    } : undefined
  }, label), sub && /*#__PURE__*/React.createElement("span", {
    className: "menu-item-sub"
  }, sub), shortcut && /*#__PURE__*/React.createElement("kbd", {
    className: "kbd",
    style: {
      marginLeft: 'auto'
    }
  }, shortcut));
}
function MenuLabel({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "caps-muted menu-label"
  }, children);
}
function MenuDivider() {
  return /*#__PURE__*/React.createElement("div", {
    className: "menu-divider"
  });
}
Object.assign(__ds_scope, { Menu, MenuItem, MenuLabel, MenuDivider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Menu.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SearchTrigger.jsx
try { (() => {
function SearchTrigger({
  placeholder = 'Search deals, companies, contacts',
  shortcut = 'Ctrl K',
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "search-trigger",
    onClick: onClick,
    "aria-label": "Search and commands"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 15,
    stroke: 1.8
  }), /*#__PURE__*/React.createElement("span", {
    className: "search-trigger-text"
  }, placeholder), /*#__PURE__*/React.createElement("kbd", {
    className: "kbd"
  }, shortcut));
}
Object.assign(__ds_scope, { SearchTrigger });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SearchTrigger.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SortHeader.jsx
try { (() => {
function SortHeader({
  label,
  active,
  dir = 1,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sort-btn",
    onClick: onClick,
    style: {
      color: active ? 'var(--ink)' : 'var(--text-2)'
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10
    }
  }, active ? dir === 1 ? '↑' : '↓' : ''));
}
function TableHead({
  cols,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "table-head",
    style: {
      gridTemplateColumns: cols
    }
  }, children);
}
function TableRow({
  cols,
  children,
  onClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: onClick ? 'table-row clickable' : 'table-row',
    style: {
      gridTemplateColumns: cols
    },
    onClick: onClick
  }, children);
}
Object.assign(__ds_scope, { SortHeader, TableHead, TableRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SortHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/StageBar.jsx
try { (() => {
function StageBar({
  stages = [],
  current = 0,
  lost,
  onPick
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "stage-bar"
  }, stages.map((s, i) => /*#__PURE__*/React.createElement("button", {
    key: s,
    type: "button",
    className: 'stage-chev' + (i === current ? ' current' : i < current ? ' done' : '') + (lost ? ' lost' : '') + (!lost && i === stages.length - 1 && i === current ? ' won' : ''),
    disabled: i === current || lost,
    onClick: () => onPick && onPick(i)
  }, s)));
}
Object.assign(__ds_scope, { StageBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/StageBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/CompaniesScreen.jsx
try { (() => {
function CompaniesScreen({
  leads,
  stages,
  openLead
}) {
  const {
    FilterBar,
    Card,
    TableHead,
    TableRow,
    SortHeader
  } = window.CadenceCRMDesignSystem_587d04;
  const COLS = '1.5fr 1.1fr 1fr 0.9fr 0.7fr 1fr 1.1fr 1.1fr';
  const [sort, setSort] = React.useState({
    k: 'company',
    d: 1
  });
  const H = [['company', 'Company'], ['industry', 'Industry'], ['hq', 'HQ'], ['size', 'Team size'], ['contacts', 'Contacts'], ['value', 'Open value'], ['stage', 'Latest stage'], ['owner', 'Owner']];
  const rows = leads.map((l, i) => ({
    ...l,
    hq: ['Belgrade', 'Novi Sad', 'Oslo', 'Split', 'Zagreb', 'Niš'][i],
    size: ['51–200 staff', '11–50 staff', '11–50 staff', '201–1,000 staff', '51–200 staff', '1–10 staff'][i],
    contacts: i % 3 + 1,
    stageName: stages.find(s => s.id === l.stage).name
  })).sort((a, b) => (String(a[sort.k]) > String(b[sort.k]) ? 1 : -1) * sort.d);
  const tog = k => setSort(s => ({
    k,
    d: s.k === k ? -s.d : 1
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(FilterBar, {
    chips: [{
      value: 'Industry',
      options: ['Industry', 'Wine', 'Banking']
    }, {
      value: 'Owner',
      options: ['Owner', 'Ana P.', 'Marko J.']
    }],
    meta: rows.length + ' companies',
    extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      className: "btn-plain"
    }, "Import"), /*#__PURE__*/React.createElement("button", {
      className: "btn-plain"
    }, "Export"))
  }), /*#__PURE__*/React.createElement(Card, {
    pad: false,
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 980
    }
  }, /*#__PURE__*/React.createElement(TableHead, {
    cols: COLS
  }, H.map(([k, l]) => /*#__PURE__*/React.createElement(SortHeader, {
    key: k,
    label: l,
    active: sort.k === k,
    dir: sort.d,
    onClick: () => tog(k)
  }))), rows.map(c => /*#__PURE__*/React.createElement(TableRow, {
    key: c.id,
    cols: COLS,
    onClick: () => openLead(c.id)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, c.company), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, c.industry), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, c.hq), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, c.size), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)'
    }
  }, c.contacts), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--brand)'
    }
  }, c.value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5
    }
  }, c.stageName), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-2)',
      fontSize: 12.5
    }
  }, c.owner))))));
}
window.CompaniesScreen = CompaniesScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/CompaniesScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/DealScreen.jsx
try { (() => {
function DealScreen({
  lead,
  stages,
  moveLead,
  back,
  toast
}) {
  const {
    Card,
    Icon,
    StageBar,
    FieldRow,
    GhostInput,
    GhostSelect,
    Avatar,
    TaskCheck,
    Button,
    Badge
  } = window.CadenceCRMDesignSystem_587d04;
  const idx = stages.findIndex(s => s.id === lead.stage);
  const [todos, setTodos] = React.useState([{
    t: 'Confirm decision process',
    d: true
  }, {
    t: 'Book proposal walkthrough',
    d: false
  }, {
    t: 'Score CHAMP',
    d: false
  }]);
  const [tab, setTab] = React.useState('Email');
  const fitFg = lead.fit >= 80 ? '#14503C' : lead.fit >= 55 ? '#B4531B' : '#B42318';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card deal-header",
    style: {
      padding: '16px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "deal-crumb"
  }, /*#__PURE__*/React.createElement("a", {
    className: "crumb-link",
    onClick: back,
    style: {
      cursor: 'pointer'
    }
  }, "Sales"), /*#__PURE__*/React.createElement("span", null, "\u2192"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink)'
    }
  }, stages[idx].name)), /*#__PURE__*/React.createElement("div", {
    className: "deal-header-top"
  }, /*#__PURE__*/React.createElement("input", {
    className: "ghost deal-title",
    defaultValue: lead.company
  }), /*#__PURE__*/React.createElement("div", {
    className: "deal-actions"
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: 'var(--text-2)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "owner"
  }), /*#__PURE__*/React.createElement("select", {
    className: "form-input",
    style: {
      padding: '7px 9px'
    },
    defaultValue: lead.owner
  }, /*#__PURE__*/React.createElement("option", null, "Ana P."), /*#__PURE__*/React.createElement("option", null, "Marko J."))), /*#__PURE__*/React.createElement(Button, {
    variant: "won",
    onClick: () => {
      moveLead(lead.id, 's6');
      toast('Deal marked won');
    }
  }, "Won"), /*#__PURE__*/React.createElement(Button, {
    variant: "lost",
    onClick: () => toast('Pick a reason to mark it lost')
  }, "Lost"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    style: {
      padding: '10px 12px'
    }
  }, "\u22EF"))), /*#__PURE__*/React.createElement(StageBar, {
    stages: stages.map((s, i) => i === idx ? '4 days · ' + s.name : s.name),
    current: idx,
    onPick: i => moveLead(lead.id, stages[i].id)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 18,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 400px',
      maxWidth: 540,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card card-pad"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, "Summary"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      marginTop: 12,
      paddingTop: 12,
      borderTop: '1px solid var(--divider)'
    }
  }, /*#__PURE__*/React.createElement(FieldRow, {
    icon: "value",
    label: "Deal value"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '6px 9px',
      display: 'flex',
      alignItems: 'baseline',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600
    }
  }, lead.value, ".00"), /*#__PURE__*/React.createElement("a", {
    style: {
      fontSize: 12.5,
      cursor: 'pointer'
    }
  }, "2 products"))), /*#__PURE__*/React.createElement(FieldRow, {
    icon: "contacts",
    label: "Contacts"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '6px 9px',
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: lead.contact.split(' ').map(x => x[0]).join(''),
    size: 20,
    font: 9.5
  }), lead.contact)), /*#__PURE__*/React.createElement(FieldRow, {
    icon: "calendar",
    label: "Closing date"
  }, /*#__PURE__*/React.createElement(GhostInput, {
    type: "date",
    defaultValue: "2026-11-14"
  })), /*#__PURE__*/React.createElement(FieldRow, {
    icon: "funnel",
    label: "Funnel"
  }, /*#__PURE__*/React.createElement(GhostSelect, {
    options: ['Sales', 'Renewals']
  })), /*#__PURE__*/React.createElement(FieldRow, {
    icon: "source",
    label: "Source"
  }, /*#__PURE__*/React.createElement(GhostSelect, {
    options: ['Referral', 'Conference', 'Inbound web form', 'Trade fair', 'Instagram DM', 'Outbound LinkedIn'],
    defaultValue: lead.source
  })))), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-title"
  }, "Fit score"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      letterSpacing: '-0.02em',
      fontSize: 26,
      lineHeight: 1,
      color: fitFg
    }
  }, lead.fit)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-2)',
      lineHeight: 1.5
    }
  }, "Scored with CHAMP inside the qualification to-do. ", lead.fit >= 80 ? 'Qualified.' : lead.fit >= 55 ? 'Nurture — gaps remain.' : 'Below the floor.'))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '999 1 480px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderBottom: '1px solid var(--divider)',
      padding: '0 10px'
    }
  }, ['Email', 'Call', 'Meeting', 'Note'].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: "composer-tab",
    onClick: () => setTab(t),
    style: {
      color: tab === t ? 'var(--ink)' : 'var(--text-2)',
      fontWeight: tab === t ? 600 : 400,
      borderBottom: '2px solid ' + (tab === t ? 'var(--brand)' : 'transparent')
    }
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    className: "box-input",
    rows: 4,
    placeholder: 'Log a ' + tab.toLowerCase() + '…'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => toast(tab + ' logged')
  }, "Log ", tab.toLowerCase())))), /*#__PURE__*/React.createElement("div", {
    className: "card card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, "To-dos \xB7 ", stages[idx].name), /*#__PURE__*/React.createElement("span", {
    className: "caps-muted"
  }, todos.filter(x => x.d).length, " of ", todos.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, todos.map((x, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement(TaskCheck, {
    done: x.d,
    onClick: () => setTodos(ts => ts.map((y, j) => j === i ? {
      ...y,
      d: !y.d
    } : y))
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: x.d ? 'var(--muted)' : 'var(--ink)',
      textDecoration: x.d ? 'line-through' : 'none'
    }
  }, x.t))))))));
}
window.DealScreen = DealScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/DealScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/PipelineScreen.jsx
try { (() => {
function PipelineScreen({
  leads,
  stages,
  moveLead,
  openLead
}) {
  const {
    FilterBar,
    FitScore,
    Badge,
    EmptyDashed
  } = window.CadenceCRMDesignSystem_587d04;
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(FilterBar, {
    chips: [{
      value: 'Sales',
      options: ['Sales', 'Renewals']
    }, {
      value: 'Salesperson',
      options: ['Salesperson', 'Ana P.', 'Marko J.']
    }, {
      value: 'Industry',
      options: ['Industry', 'Wine', 'Banking']
    }, {
      value: 'Value',
      options: ['Value', 'Under €25k']
    }, {
      value: 'Open & won deals',
      options: ['Open & won deals', 'Include lost deals']
    }],
    meta: leads.length + ' leads · €301k open',
    extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      className: "btn-plain"
    }, "Import"), /*#__PURE__*/React.createElement("button", {
      className: "btn-plain"
    }, "Export"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      overflowX: 'auto',
      margin: '0 -30px -44px',
      padding: '0 30px',
      minHeight: 'calc(100vh - 150px)'
    }
  }, stages.map((st, ci) => {
    const cards = leads.filter(l => l.stage === st.id);
    const first = ci === 0,
      last = ci === stages.length - 1;
    const active = over === st.id;
    return /*#__PURE__*/React.createElement("div", {
      key: st.id,
      onDragOver: e => {
        e.preventDefault();
        setOver(st.id);
      },
      onDragLeave: () => over === st.id && setOver(null),
      onDrop: e => {
        e.preventDefault();
        if (drag) moveLead(drag, st.id);
        setDrag(null);
        setOver(null);
      },
      style: {
        flex: '0 0 268px',
        width: 268,
        border: '1px solid ' + (active ? '#14503C' : 'transparent'),
        borderRadius: '6px 6px 0 0',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: last ? 268 : 282,
        position: 'relative',
        background: active ? '#D7E9E1' : '#EFF3F1',
        height: 57,
        clipPath: first ? 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)' : last ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%)' : 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)',
        padding: first ? '12px 30px 12px 12px' : last ? '12px 12px 12px 26px' : '12px 30px 12px 26px',
        borderRadius: last ? '6px 6px 0 0' : '6px 0 0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600
      }
    }, st.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: 'var(--text-2)'
      }
    }, "\u20AC", cards.length * 40, "k \xB7 ", cards.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flex: 1,
        background: active ? '#E7F2EE' : '#EFF3F1'
      }
    }, cards.map(l => /*#__PURE__*/React.createElement("div", {
      key: l.id,
      draggable: true,
      onDragStart: e => {
        e.dataTransfer.setData('text/plain', l.id);
        setDrag(l.id);
      },
      onDragEnd: () => {
        setDrag(null);
        setOver(null);
      },
      onClick: () => openLead(l.id),
      style: {
        background: 'var(--white)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-tile)',
        padding: '11px 12px',
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: drag === l.id ? 0.45 : 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        fontWeight: 600,
        lineHeight: 1.25
      }
    }, l.company), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--brand)',
        whiteSpace: 'nowrap'
      }
    }, l.value)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--text-2)'
      }
    }, l.contact, " \xB7 ", l.role), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(FitScore, {
      score: l.fit
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: l.stall >= 4 ? '#B42318' : '#475750'
      }
    }, l.stall === 0 ? 'active today' : l.stall + 'd since contact')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--text-2)',
        borderTop: '1px dashed var(--border)',
        paddingTop: 7,
        lineHeight: 1.35
      }
    }, "Next: ", st.activity, l.noNext && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      tone: "warn"
    }, "No next step"))))), cards.length === 0 && /*#__PURE__*/React.createElement(EmptyDashed, null)));
  })));
}
window.PipelineScreen = PipelineScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/PipelineScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/ScreenHeader.jsx
try { (() => {
function ScreenHeader({
  title,
  parent,
  onParent,
  onCreate
}) {
  const {
    SearchTrigger,
    IconButton,
    Menu,
    MenuItem
  } = window.CadenceCRMDesignSystem_587d04;
  const [open, setOpen] = React.useState(false);
  const items = [['deal', 'Deal', 'D'], ['contact', 'Contact', 'P'], ['company', 'Company', 'O'], ['task', 'Task', 'T'], ['product', 'Product', 'R']];
  return /*#__PURE__*/React.createElement("header", {
    className: "screen-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "header-title"
  }, parent && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("a", {
    className: "crumb-link header-parent",
    onClick: onParent,
    style: {
      cursor: 'pointer'
    }
  }, parent), /*#__PURE__*/React.createElement("span", {
    className: "header-sep"
  }, "/")), /*#__PURE__*/React.createElement("h1", null, title)), /*#__PURE__*/React.createElement("div", {
    className: "header-center"
  }, /*#__PURE__*/React.createElement(SearchTrigger, null), /*#__PURE__*/React.createElement("div", {
    className: "new-menu"
  }, /*#__PURE__*/React.createElement(IconButton, {
    variant: "round",
    icon: open ? 'x' : 'plus',
    title: "Create new",
    active: open,
    onClick: () => setOpen(!open)
  }), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 30
    }
  }, /*#__PURE__*/React.createElement(Menu, null, items.map(([ic, l, k], i) => /*#__PURE__*/React.createElement(MenuItem, {
    key: l,
    icon: ic,
    label: l,
    shortcut: k,
    active: i === 0,
    onClick: () => {
      setOpen(false);
      onCreate(l);
    }
  })))))), /*#__PURE__*/React.createElement("div", {
    className: "header-right"
  }, /*#__PURE__*/React.createElement(IconButton, {
    variant: "ghost-round",
    icon: "bell",
    badge: 2,
    title: "Notifications"
  }), /*#__PURE__*/React.createElement("button", {
    className: "avatar-btn"
  }, "AP")));
}
window.ScreenHeader = ScreenHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/ScreenHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/Sidebar.jsx
try { (() => {
const NAV_ITEMS = [{
  id: 'overview',
  label: 'Overview',
  icon: 'overview'
}, {
  id: 'pipeline',
  label: 'Pipeline',
  icon: 'pipeline'
}, {
  id: 'today',
  label: 'Today',
  icon: 'today'
}, {
  id: 'companies',
  label: 'Companies',
  icon: 'company'
}, {
  id: 'contacts',
  label: 'Contacts',
  icon: 'contact'
}, {
  id: 'products',
  label: 'Products',
  icon: 'product'
}];
function Sidebar({
  screen,
  go,
  overdue
}) {
  const {
    Icon
  } = window.CadenceCRMDesignSystem_587d04;
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 96,
      flex: '0 0 96px',
      background: 'var(--forest)',
      color: '#F5F7F6',
      padding: '18px 8px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 18,
      position: 'sticky',
      top: 0,
      height: '100vh'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "ws-logo",
    title: "Pultly \xB7 switch workspace"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 48",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14 4h48L52 34H4z",
    fill: "#FFFFFF"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 28h5l2.7-8h-5z",
    fill: "#0D241C"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M28 28h5l4-12h-5z",
    fill: "#0D241C"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M36 28h5l5.3-16h-5z",
    fill: "#C6F16A"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "39",
    width: "36",
    height: "5",
    rx: "2.5",
    fill: "#FFFFFF"
  }))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      width: '100%'
    }
  }, NAV_ITEMS.map(n => {
    const active = screen === n.id || n.id === 'pipeline' && screen === 'deal';
    const fg = active ? '#F5F7F6' : '#93A39B';
    return /*#__PURE__*/React.createElement("a", {
      key: n.id,
      onClick: () => go(n.id),
      style: {
        textDecoration: 'none',
        width: '100%',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        width: '100%',
        padding: '2px 0 4px',
        color: fg
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 46,
        height: 42,
        borderRadius: 11,
        background: active ? 'var(--green-500)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: n.icon,
      size: 21,
      color: fg
    })), n.id === 'today' && overdue > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: 0,
        right: 14,
        minWidth: 17,
        height: 17,
        padding: '0 5px',
        borderRadius: 9,
        background: '#B42318',
        color: '#FFFFFF',
        fontSize: 10.5,
        fontWeight: 600,
        lineHeight: '17px',
        textAlign: 'center'
      }
    }, overdue), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.01em',
        lineHeight: 1.2
      }
    }, n.label)));
  })));
}
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/TodayScreen.jsx
try { (() => {
function TodayScreen({
  leads,
  stages,
  channel,
  openLead
}) {
  const {
    FilterBar,
    TaskCheck,
    ChannelChip
  } = window.CadenceCRMDesignSystem_587d04;
  const [hand, setHand] = React.useState([{
    id: 't1',
    title: 'Send revised quote',
    leadId: 'l2',
    due: 'was due 26 Sep',
    overdue: true,
    done: false
  }, {
    id: 't2',
    title: 'Call about procurement form',
    leadId: 'l3',
    due: 'today',
    done: false
  }]);
  const byId = id => leads.find(l => l.id === id);
  const stName = l => stages.find(s => s.id === l.stage).name;
  const funnel = leads.map(l => ({
    id: l.id,
    leadId: l.id,
    title: stages.find(s => s.id === l.stage).activity,
    due: l.stall >= 4 ? 'today · ' + l.stall + ' days since contact' : l.stall > 0 ? 'today' : 'tomorrow',
    bucket: l.stall > 0 ? 1 : 2,
    chan: channel[l.stage]
  }));
  const tasks = [...hand.map(t => ({
    ...t,
    task: true,
    bucket: t.overdue ? 0 : 1,
    chan: 'Call'
  })), ...funnel];
  const groups = [{
    label: 'Overdue',
    fg: '#B42318',
    b: 0
  }, {
    label: 'Today',
    fg: '#0F1B16',
    b: 1
  }, {
    label: 'Next up',
    fg: '#475750',
    b: 2
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(FilterBar, {
    chips: [{
      value: 'Salesperson',
      options: ['Salesperson', 'Ana P.', 'Marko J.']
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: 'var(--text-2)',
      lineHeight: 1.55,
      maxWidth: 640
    }
  }, "Tasks are generated by the funnel, and each one opens with the script for that stage. Tasks added with New task sit alongside them until they are done."), groups.map(g => {
    const ts = tasks.filter(t => t.bucket === g.b);
    return /*#__PURE__*/React.createElement("div", {
      key: g.label,
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 9
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: g.fg
      }
    }, g.label), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        height: 1,
        background: 'var(--border)'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--text-2)'
      }
    }, ts.length === 1 ? '1 task' : ts.length + ' tasks')), ts.map(t => {
      const l = byId(t.leadId);
      return /*#__PURE__*/React.createElement("div", {
        key: t.id,
        style: {
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 15px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap'
        }
      }, t.task && /*#__PURE__*/React.createElement(TaskCheck, {
        done: t.done,
        onClick: () => setHand(h => h.map(x => x.id === t.id ? {
          ...x,
          done: !x.done
        } : x))
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 3
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 13.5,
          fontWeight: 600,
          color: t.done ? '#93A39B' : undefined,
          textDecoration: t.done ? 'line-through' : 'none'
        }
      }, t.title), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: t.overdue ? 'var(--danger)' : 'var(--text-2)'
        }
      }, l.company, " \xB7 ", stName(l), " \xB7 ", t.overdue ? 'overdue · ' + t.due : 'due ' + t.due, t.task ? ' · Ana Petrović' : '')), /*#__PURE__*/React.createElement(ChannelChip, null, t.chan), t.task && /*#__PURE__*/React.createElement("button", {
        className: "btn-outline"
      }, "Edit"), /*#__PURE__*/React.createElement("button", {
        className: "btn-outline",
        onClick: () => openLead(t.leadId)
      }, t.task ? 'Open lead' : 'Open script'));
    }));
  })));
}
window.TodayScreen = TodayScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/TodayScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/data.js
try { (() => {
window.CRM_DATA = {
  stages: [{
    id: 's1',
    name: 'New lead',
    activity: 'Qualify & research'
  }, {
    id: 's2',
    name: 'Qualified',
    activity: 'Personalized email'
  }, {
    id: 's3',
    name: 'Discovery',
    activity: 'Discovery call'
  }, {
    id: 's4',
    name: 'Proposal',
    activity: 'Send proposal + walkthrough'
  }, {
    id: 's5',
    name: 'Negotiation',
    activity: 'Negotiation call'
  }, {
    id: 's6',
    name: 'Won',
    activity: 'Kickoff scheduling'
  }],
  leads: [{
    id: 'l1',
    company: 'Northwind Freight',
    contact: 'Ana Petrović',
    role: 'Head of Marketing',
    value: '€48,000',
    stage: 's3',
    fit: 84,
    stall: 0,
    owner: 'Ana P.',
    industry: 'Freight & logistics',
    source: 'Referral'
  }, {
    id: 'l2',
    company: 'Vinarija Zlatni Breg',
    contact: 'Marko Jovanović',
    role: 'Owner',
    value: '€22,500',
    stage: 's2',
    fit: 70,
    stall: 3,
    owner: 'Marko J.',
    industry: 'Wine',
    source: 'Trade fair'
  }, {
    id: 'l3',
    company: 'Halden Architects',
    contact: 'Sofia Lind',
    role: 'Partner',
    value: '€64,000',
    stage: 's4',
    fit: 88,
    stall: 1,
    owner: 'Ana P.',
    industry: 'Architecture',
    source: 'Inbound web form',
    noNext: true
  }, {
    id: 'l4',
    company: 'Brava Hotels',
    contact: 'Luka Horvat',
    role: 'GM',
    value: '€31,000',
    stage: 's1',
    fit: 52,
    stall: 5,
    owner: 'Marko J.',
    industry: 'Hospitality',
    source: 'Instagram DM'
  }, {
    id: 'l5',
    company: 'Solaris Energija',
    contact: 'Ivana Kovač',
    role: 'CFO',
    value: '€120,000',
    stage: 's5',
    fit: 91,
    stall: 0,
    owner: 'Ana P.',
    industry: 'Renewable energy',
    source: 'Conference'
  }, {
    id: 'l6',
    company: 'Kuća Nameštaja',
    contact: 'Petar Ilić',
    role: 'Buyer',
    value: '€15,800',
    stage: 's1',
    fit: 61,
    stall: 2,
    owner: 'Marko J.',
    industry: 'Furniture retail',
    source: 'Outbound LinkedIn'
  }],
  channel: {
    s1: 'Research task',
    s2: 'Email',
    s3: 'Meeting',
    s4: 'Email',
    s5: 'Meeting',
    s6: 'Email'
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.FitScore = __ds_scope.FitScore;

__ds_ns.ChannelChip = __ds_scope.ChannelChip;

__ds_ns.Kbd = __ds_scope.Kbd;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.ICON_PATHS = __ds_scope.ICON_PATHS;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.EmptyDashed = __ds_scope.EmptyDashed;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.ModalHeader = __ds_scope.ModalHeader;

__ds_ns.ModalActions = __ds_scope.ModalActions;

__ds_ns.HintBox = __ds_scope.HintBox;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Choice = __ds_scope.Choice;

__ds_ns.ChoicePill = __ds_scope.ChoicePill;

__ds_ns.FieldRow = __ds_scope.FieldRow;

__ds_ns.FormField = __ds_scope.FormField;

__ds_ns.GhostInput = __ds_scope.GhostInput;

__ds_ns.GhostSelect = __ds_scope.GhostSelect;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.TaskCheck = __ds_scope.TaskCheck;

__ds_ns.FilterBar = __ds_scope.FilterBar;

__ds_ns.Menu = __ds_scope.Menu;

__ds_ns.MenuItem = __ds_scope.MenuItem;

__ds_ns.MenuLabel = __ds_scope.MenuLabel;

__ds_ns.MenuDivider = __ds_scope.MenuDivider;

__ds_ns.SearchTrigger = __ds_scope.SearchTrigger;

__ds_ns.SortHeader = __ds_scope.SortHeader;

__ds_ns.TableHead = __ds_scope.TableHead;

__ds_ns.TableRow = __ds_scope.TableRow;

__ds_ns.StageBar = __ds_scope.StageBar;

})();
