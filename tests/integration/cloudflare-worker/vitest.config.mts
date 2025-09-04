import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { resolve } from 'path';

export default defineWorkersConfig({
	test: {
		include: ['tests/integration/cloudflare-worker/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
		poolOptions: {
			workers: {
				wrangler: { 
					configPath: resolve(__dirname, '../../../examples/cloudflare-worker/wrangler.jsonc') 
				},
				miniflare: {
					d1Databases: ['DB'],
					kvNamespaces: ['RATE_LIMIT_KV'],
				},
			},
		},
	},
});
