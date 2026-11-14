import { handle, runCron } from './core.js';

export default {
  fetch(request, env) {
    return handle(request, env);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  }
};
