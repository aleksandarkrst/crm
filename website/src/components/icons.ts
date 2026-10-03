// 24×24 stroke paths from the Pultly design system (components/core/iconPaths.js), only the ones the site uses.
export const ICON_PATHS = {
  overview: "M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6",
  pipeline: "M4 5h5v14H4zM15 5h5v9h-5z",
  today: "M5 5h14v14H5zM9 12l2 2 4-4",
  company: "M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1",
  settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.5-2-1.5Z",
  contacts: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  building: "M4 21V5l8-2v18M12 8h8v13M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01M2 21h20",
  location: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  team: "M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  document: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  search: "M20 20l-4.2-4.2M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
} as const;

export type IconName = keyof typeof ICON_PATHS;
