/** Worker thread entry for netFetch.convertHtml: converts workerData.html and posts the text back. */
import { parentPort, workerData } from 'node:worker_threads';
import { htmlToMarkdown } from './htmlMarkdown.js';

const { html, opts } = workerData as { html: string; opts: { baseUrl?: string; markup?: boolean } };
parentPort!.postMessage(htmlToMarkdown(html, opts));
