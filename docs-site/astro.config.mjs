// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Published under the org domain at /fountain-ops, the same shape loomster and
// chant-bench use. `base` has to match or every internal link 404s on Pages.
export default defineConfig({
	site: 'https://intentius.io',
	base: '/fountain-ops',
	// First login stopped being a page when the bootstrap moved in-app: the
	// happy path lives in stand-it-up, the manual recipes in the reference.
	// The old URL is in READMEs and link history, so it redirects.
	redirects: {
		'/getting-started/first-login/': '/fountain-ops/reference/promote-admin/',
	},
	integrations: [
		starlight({
			title: 'fountain-ops',
			description: 'Self-hosted fountain, deployed by chant. Targets, tiers and seams, no shell.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/INTENTIUS/fountain-ops' },
			],
			editLink: {
				baseUrl: 'https://github.com/INTENTIUS/fountain-ops/edit/main/docs-site/',
			},
			// The status page is the one people will link to and argue with, so
			// it gets a stable place in the order rather than sorting alphabetically
			// into the middle of the reference.
			sidebar: [
				{
					label: 'Getting started',
					items: [
						{ label: 'What this is', slug: 'getting-started/overview' },
						{ label: 'Stand it up locally', slug: 'getting-started/stand-it-up' },
						{ label: 'Stand it up on a real cluster', slug: 'getting-started/real-cluster' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Targets and tiers', slug: 'reference/targets-and-tiers' },
						{ label: 'Seams', slug: 'reference/seams' },
						{ label: 'Build parameters', slug: 'reference/parameters' },
						{ label: 'The data plane', slug: 'reference/data-plane' },
						{ label: 'Backups and restore', slug: 'reference/backups' },
						{ label: 'Secrets', slug: 'reference/secrets' },
						{ label: 'Promoting an admin', slug: 'reference/promote-admin' },
						{ label: 'The just targets', slug: 'reference/commands' },
						{ label: 'CI and the site', slug: 'reference/ci' },
						{ label: 'Operating from behold', slug: 'reference/behold' },
					],
				},
				{ label: 'Status', slug: 'status' },
			],
		}),
	],
});
