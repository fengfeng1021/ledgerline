/* Bridge between the shared profile and an individual tool.
   A tool the visitor has never touched adopts the profile silently. A tool with
   its own saved state offers the sync instead of overwriting work. */

import { t, toast, money } from './core.js';
import { loadProfile, hasProfile, derive, adapt } from './profile.js';

export function mountProfileBridge(toolId, store, opts = {}) {
  const mount = document.getElementById('profileLink');
  if (!mount) return null;

  const P = loadProfile();
  const filled = hasProfile(P);

  if (!filled) {
    mount.innerHTML =
      `<a class="profile-cta profile-cta--empty" href="../profile/">
         <span class="profile-cta__title">${t('profile.emptyH')}</span>
         <span class="profile-cta__sub">${t('bridge.emptySub')}</span>
       </a>`;
    return null;
  }

  const d = derive(P);
  const patch = adapt[toolId] ? adapt[toolId](P, d) : null;
  if (!patch) {
    mount.innerHTML =
      `<a class="profile-cta profile-cta--empty" href="../profile/">
         <span class="profile-cta__title">${t('bridge.needMore')}</span>
         <span class="profile-cta__sub">${t('bridge.needMoreSub.' + toolId)}</span>
       </a>`;
    return null;
  }

  const KEY = 'ledgerline:' + toolId;
  let virgin = false;
  try { virgin = !localStorage.getItem(KEY); } catch (e) { /* noop */ }
  const fromLink = location.hash.length > 1;

  // A first visit with no shared link adopts the file without being asked:
  // that is the whole point of having entered it once.
  if (virgin && !fromLink) {
    store.replace({ ...store.get(), ...patch });
    opts.afterAdopt?.();
  }

  const render = (synced) => {
    mount.innerHTML =
      `<div class="profile-cta ${synced ? 'is-synced' : ''}">
         <span class="profile-cta__title">${synced ? t('common.usingProfile') : t('bridge.available')}</span>
         <span class="profile-cta__sub">${t('bridge.netWorth', { net: money(d.net) })}</span>
         <span class="profile-cta__row">
           ${synced ? '' : `<button class="btn btn--ghost" type="button" data-adopt>${t('bridge.adopt')}</button>`}
           <a class="btn btn--quiet" href="../profile/">${t('bridge.edit')}</a>
         </span>
       </div>`;
    mount.querySelector('[data-adopt]')?.addEventListener('click', () => {
      store.replace({ ...store.get(), ...patch });
      opts.afterAdopt?.();
      render(true);
      toast(t('common.usingProfile'));
    });
  };
  render(virgin && !fromLink);

  return { profile: P, derived: d, patch };
}
