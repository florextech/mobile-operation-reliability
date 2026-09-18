const config = {
  title: 'FlorexTech MOR',
  tagline: 'Durable business operations for mobile REST clients',
  favicon: 'img/favicon.svg',
  url: process.env.DOCS_URL ?? 'http://localhost:3000',
  baseUrl: process.env.DOCS_BASE_URL ?? '/',
  organizationName: 'FlorexTech',
  projectName: 'mobile-operation-reliability',
  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'warn' } },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: { sidebarPath: './sidebars.mjs', routeBasePath: '/' },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'FlorexTech MOR',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Guides' },
        { href: 'https://github.com/FlorexTech/mobile-operation-reliability', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [{ label: 'Integration', to: '/integration' }, { label: 'Backend contract', to: '/backend-contract' }],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} FlorexTech.`,
    },
  },
};

export default config;
