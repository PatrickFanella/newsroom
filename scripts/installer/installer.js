const token = location.hash.slice(1);
history.replaceState(null, '', '/');
const $ = id => document.getElementById(id);
let step = 0, requirementsReady = false, resumable = false, timer;
const titles = ['A newsroom of your own.', 'Give it an address.', 'Choose your way in.', 'Make room for your tools.', 'Ready when you are.'];
const api = async (path, data) => {
  const response = await fetch('/api/' + path, { headers: { 'x-installer-token': token, ...(data ? { 'content-type': 'application/json' } : {}) }, method: data ? 'POST' : 'GET', ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The installer could not finish that step.');
  return result;
};
const error = message => { $('error').textContent = message; $('error').hidden = !message; };
function showStep() {
  document.querySelectorAll('[data-step]').forEach(section => { section.hidden = Number(section.dataset.step) !== step; });
  document.querySelectorAll('#steps li').forEach((item, index) => { if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
  $('step-label').textContent = `STEP ${step + 1} OF 5`;
  $('heading').textContent = titles[step]; $('intro').hidden = step !== 0;
  $('back').hidden = step === 0; $('next').hidden = step === 4;
  $('next').disabled = step === 0 && !requirementsReady;
  $('heading').focus(); error('');
}
function conditionalFields() {
  $('email-fields').hidden = $('auth').value === 'twitch';
  $('twitch-fields').hidden = $('auth').value === 'email';
  $('claude-fields').hidden = $('ai').value !== 'anthropic';
  $('openai-fields').hidden = $('ai').value !== 'openai-compatible';
  for (const id of ['SMTP_HOST', 'SMTP_FROM']) $(id).required = $('auth').value !== 'twitch';
  $('SMTP_PASSWORD').required = $('auth').value !== 'twitch' && !!$('SMTP_USER').value;
  for (const id of ['NEXT_PUBLIC_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) $(id).required = $('auth').value !== 'email';
  $('ANTHROPIC_API_KEY').required = $('ai').value === 'anthropic';
  $('OPENAI_MODEL').required = $('ai').value === 'openai-compatible';
  $('callback').textContent = $('origin').value.replace(/\/+$/, '') + '/api/twitch/callback';
  $('proxy-help').textContent = $('proxy').value === 'managed' ? 'We’ll start Caddy to obtain and renew your website’s certificate. Your domain must point to this server, with ports 80 and 443 open and available.' : `Keep your existing proxy. Point it to 127.0.0.1:${$('port').value || 3000} on this server, pass the original host and scheme, and replace incoming X-Forwarded-For with the client address it trusts.`;
}
async function check() {
  $('recheck').disabled = true; error('');
  try {
    const result = await api('checks');
    $('checks').replaceChildren(...result.checks.map(check => { const li = document.createElement('li'); li.textContent = `${check.name}: ${check.detail}`; li.className = check.ok ? 'ok' : 'bad'; return li; }));
    requirementsReady = result.checks.every(check => check.ok);
    const status = await api('status'); resumable = status.resumable;
    $('existing').hidden = !status.configured;
    $('existing-text').textContent = resumable ? 'Your saved secrets and settings will be kept. Resume to build and start the app again.' : 'We will keep it untouched. Follow the manual self-hosting guide, or use a separate checkout for a new installation.';
    $('resume').hidden = !resumable;
    $('next').disabled = !requirementsReady || status.configured;
    if (status.busy || status.outcome) { showProgress(); await poll(); }
  } catch (failure) { error(failure.message); }
  finally { $('recheck').disabled = false; }
}
const payload = () => {
  const entries = Object.fromEntries(new FormData($('setup')));
  return { origin: entries.origin, proxy: entries.proxy, auth: entries.auth, ai: entries.ai, port: entries.port, values: entries };
};
async function review() {
  const { plan } = await api('review', payload());
  $('review').replaceChildren();
  const labels = { managed: 'Automatic HTTPS', existing: 'Existing HTTPS proxy', email: 'Email links', twitch: 'Twitch', both: 'Email and Twitch', none: 'No AI for now', anthropic: 'Claude', 'openai-compatible': 'OpenAI-compatible provider' };
  for (const [label, value] of [['Website', plan.origin], ['HTTPS', labels[plan.proxy]], ['Sign-in', labels[plan.auth]], ['AI', labels[plan.ai]], ['App port', String(plan.port)]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('review').append(dt, dd);
  }
  $('plan').replaceChildren(...plan.steps.map(text => { const item = document.createElement('li'); item.textContent = text; return item; }));
}
$('setup').addEventListener('submit', async event => {
  event.preventDefault(); error('');
  try {
    conditionalFields();
    const fields = document.querySelector(`[data-step="${step}"]`).querySelectorAll('input,select');
    for (const field of fields) if (!field.closest('[hidden]') && !field.reportValidity()) return;
    if (step === 0 && !requirementsReady) throw new Error('Fix the server checks first.');
    if (step === 1 && !$('origin').value) throw new Error('Enter your HTTPS website address.');
    if (step === 3) await review();
    step = Math.min(4, step + 1); conditionalFields(); showStep();
  } catch (failure) { error(failure.message); }
});
$('back').onclick = () => { step = Math.max(0, step - 1); showStep(); };
$('recheck').onclick = check;
for (const id of ['auth', 'ai', 'proxy', 'port', 'origin', 'SMTP_USER']) $(id).addEventListener('change', conditionalFields);
for (const button of document.querySelectorAll('[data-reveal]')) button.onclick = () => {
  const input = $(button.dataset.reveal); const visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; button.textContent = visible ? 'Hide' : 'Show'; button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${document.querySelector(`label[for="${input.id}"]`)?.textContent || 'secret'}`); button.setAttribute('aria-pressed', String(visible));
};
async function poll() {
  try {
    const status = await api('status'); resumable = status.resumable;
    $('phase').textContent = status.phase;
    $('events').replaceChildren(...status.events.map((text, index) => { const item = document.createElement('li'); item.textContent = text; if (index < status.events.length - 1 || status.outcome === 'complete') item.className = 'ok'; return item; }));
    $('retry').hidden = status.outcome !== 'failed';
    $('edit-options').hidden = status.outcome !== 'failed' || resumable;
    $('running-help').hidden = !status.busy;
    $('done').hidden = status.outcome !== 'complete';
    if (status.outcome === 'complete') {
      $('open-app').href = status.plan.origin + '/login';
      $('next-help').textContent = status.websiteReady ? 'Sign in to create your account. Email users can enter their address to receive a private link.' : 'The app passed its local checks, but the HTTPS website did not. Check your domain’s DNS, open ports 80 and 443 for automatic HTTPS, or finish connecting your existing proxy. Then open your website to sign in.';
      for (const input of document.querySelectorAll('input[name]')) input.value = '';
    }
    if (status.busy) timer = setTimeout(poll, 1500);
  } catch (failure) { error(failure.message); $('retry').hidden = false; }
}
function showProgress() {
  $('setup').hidden = true; $('progress').hidden = false; $('heading').textContent = 'Putting your newsroom together.'; $('intro').hidden = true; $('step-label').textContent = 'INSTALLATION';
}
async function start(resume = false) {
  error(''); clearTimeout(timer); $('install').disabled = true; $('retry').hidden = true;
  try {
    await api(resume ? 'resume' : 'install', {});
    showProgress();
    await poll();
  } catch (failure) { error(failure.message); }
  finally { $('install').disabled = false; }
}
$('install').onclick = () => start(); $('resume').onclick = () => start(true); $('retry').onclick = () => start(resumable);
$('edit-options').onclick = () => { $('setup').hidden = false; $('progress').hidden = true; step = 1; showStep(); };
$('shutdown').onclick = async () => { try { await api('shutdown', {}); $('phase').textContent = 'Installer closed. Your app keeps running.'; $('shutdown').disabled = true; } catch (failure) { error(failure.message); } };
conditionalFields(); void check();
