import { createRequire } from 'node:module';
import { defineConfig } from 'vitepress';

// The nav version label is read from package.json at config load, so a release
// needs no hand-edit here.
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const ogTitle = 'metaschema — schemas, validation and TypeScript types for JavaScript';
const ogDescription =
  'Zero-dependency metadata schema and interface definition language for Node.js and browsers: ' +
  'declare structs and domain models once, validate data, and generate TypeScript interfaces.';
const repo = 'https://github.com/Alexis-Technologies/metaschema';
const base = '/';
const hostname = 'https://metaschema.vercel.app/';
const ogImage = `${hostname}logo.png`;

const keywords = [
  'metaschema',
  '@alexify/metaschema',
  'javascript schema',
  'schema validation',
  'data validation javascript',
  'interface definition language',
  'idl javascript',
  'domain model',
  'typescript interface generation',
  'zero dependency validation',
  'browser schema validation',
  'metarhia',
].join(', ');

// schema.org structured data: helps search and AI engines read the site as a
// software package rather than plain text.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '@alexify/metaschema',
  alternateName: 'metaschema',
  description: ogDescription,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js >= 18, browsers',
  url: hostname,
  downloadUrl: 'https://www.npmjs.com/package/@alexify/metaschema',
  codeRepository: repo,
  license: 'https://opensource.org/licenses/MIT',
  keywords,
  author: { '@type': 'Organization', name: 'Alexis Technologies' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: '@alexify/metaschema',
  titleTemplate: ':title — metaschema',
  description: ogDescription,
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#7C5CFF' }],
    ['meta', { name: 'author', content: 'Alexis Technologies' }],
    ['meta', { name: 'keywords', content: keywords }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: '@alexify/metaschema' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:description', content: ogDescription }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: ogTitle }],
    ['meta', { name: 'twitter:description', content: ogDescription }],
    ['meta', { name: 'twitter:image', content: ogImage }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(jsonLd)],
  ],

  // Per-page canonical + og:url for clean SEO indexing
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    const canonical = `${hostname}${path}`;
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
    );
  },

  themeConfig: {
    logo: { light: '/logo-mark.svg', dark: '/logo-mark-dark.svg', alt: 'metaschema' },

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'API', link: '/api/exports', activeMatch: '/api/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@alexify/metaschema' },
          { text: 'Releases', link: `${repo}/releases` },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Why metaschema?', link: '/guide/why' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Defining Schemas',
          items: [
            { text: 'Schema Syntax', link: '/guide/schema-syntax' },
            { text: 'Types', link: '/guide/types' },
            { text: 'Unions, nullable and null', link: '/guide/unions' },
            { text: 'References', link: '/guide/references' },
            { text: 'Kinds and Metadata', link: '/guide/kinds-and-metadata' },
            { text: 'Custom Types', link: '/guide/custom-types' },
          ],
        },
        {
          text: 'Using Schemas',
          items: [
            { text: 'Validation', link: '/guide/validation' },
            { text: 'Domain Models', link: '/guide/model' },
            { text: 'TypeScript', link: '/guide/typescript' },
            { text: 'Standard Schema', link: '/guide/standard-schema' },
            { text: 'JSON Schema', link: '/guide/json-schema' },
            { text: 'Browser', link: '/guide/browser' },
          ],
        },
        {
          text: 'Going Further',
          items: [
            { text: 'Performance', link: '/guide/performance' },
            { text: 'Migrating from 1.x', link: '/guide/migrating-from-1' },
            { text: 'Migrating from metarhia', link: '/guide/migrating-from-metarhia' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API',
          items: [{ text: 'Exports', link: '/api/exports' }],
        },
      ],
    },

    search: { provider: 'local' },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2017-2025 Metarhia contributors · © 2026 Alexis Technologies',
    },

    docFooter: {
      prev: 'Previous page',
      next: 'Next page',
    },
  },
});
