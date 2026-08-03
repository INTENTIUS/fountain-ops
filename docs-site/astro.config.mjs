// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Published under the org domain at /fountain-ops, the same shape loomster and
// chant-bench use. `base` has to match or every internal link 404s on Pages.
export default defineConfig({
	site: 'https://intentius.io',
	base: '/fountain-ops',
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
						{ label: 'Stand it up', slug: 'getting-started/stand-it-up' },
						{ label: 'First login', slug: 'getting-started/first-login' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Targets and tiers', slug: 'reference/targets-and-tiers' },
						{ label: 'Seams', slug: 'reference/seams' },
						{ label: 'The data plane', slug: 'reference/data-plane' },
						{ label: 'Secrets', slug: 'reference/secrets' },
						{ label: 'CI and the site', slug: 'reference/ci' },
					],
				},
				{ label: 'Status', slug: 'status' },
			],
		}),
	],
});
