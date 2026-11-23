/*
 * Bingo 75 — interface, orquestração e experiência do operador.
 * Requer js/engine.js. Não usa rede, bibliotecas ou serviços externos.
 */
(function () {
  'use strict';

  const {
    TOTAL_BALLS, KEYS, LETTERS, BingoGame, BingoStorage, SoundManager,
    letterFor, normalizeTie, makeTie, validateGame, clone, pad, secureRandomInt, nowIso
  } = window.Bingo75;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const dom = {};
  const boardBalls = new Map();
  const columnElements = new Map();
  const statusNames = { ready: 'Pronta', running: 'Em andamento', paused: 'Pausada', drawing: 'Sorteando', finished: 'Finalizada' };
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  let storage;
  let settings;
  let sound;
  let game = null;
  let savedSlots = { current: null, backup: null, finished: null };
  let tieData = makeTie();
  let isDrawing = false;
  let drawReturnStatus = 'running';
  let drawTimeout = null;
  let rollingInterval = null;
  let tieRunning = false;
  let tieTimeout = null;
  let tieNameInterval = null;
  let confirmResolve = null;
  let toastId = 0;
  let lastStorageWarning = 0;
  let lastClockRender = 0;
  let projectionRequested = false;

  function cacheDom() {
    [
      'session-status', 'session-status-text', 'session-id', 'board-count', 'current-ball', 'current-letter',
      'current-number', 'current-caption', 'stage-panel', 'live-badge', 'draw-label', 'draw-subtitle',
      'previous-label', 'recent-balls', 'metric-drawn', 'metric-remaining', 'metric-progress', 'countdown-wrap',
      'countdown-label', 'countdown-value', 'timer-track', 'timer-progress', 'stat-drawn', 'stat-time', 'stat-rounds',
      'stat-progress', 'stat-progress-bar', 'stat-remaining', 'history-panel', 'history-total', 'full-history',
      'save-status', 'settings-dialog', 'recovery-dialog', 'recovery-options', 'recovery-reopen', 'reopen-option',
      'tie-dialog', 'tie-setup', 'competitor-form', 'competitor-name', 'competitor-error', 'competitor-list',
      'tie-arena', 'tie-overline', 'tie-name-display', 'tie-result-caption', 'tie-count', 'btn-tie-repeat',
      'btn-tie-draw', 'confirm-dialog', 'confirm-title', 'confirm-message', 'confirm-cancel', 'confirm-accept',
      'toast-region', 'btn-start', 'btn-pause', 'btn-continue', 'btn-next', 'btn-finish', 'btn-new'
    ].forEach(id => { dom[id] = document.getElementById(id); });
    LETTERS.forEach(item => {
      columnElements.set(item.letter, $(`.board-column[data-letter="${item.letter}"]`));
    });
  }

  function buildBoard() {
    LETTERS.forEach(item => {
      const container = $(`[data-column="${item.letter}"]`);
      const fragment = document.createDocumentFragment();
      for (let number = item.min; number <= item.max; number += 1) {
        const ball = document.createElement('span');
        ball.className = 'board-ball';
        ball.dataset.number = String(number);
        ball.textContent = pad(number);
        ball.setAttribute('role', 'img');
        ball.setAttribute('aria-label', `${item.letter} ${pad(number)}, disponível`);
        fragment.appendChild(ball);
        boardBalls.set(number, ball);
      }
      container.appendChild(fragment);
    });
  }

  function showToast(message, type = 'info', duration = 4300) {
    const toast = document.createElement('div');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const text = document.createElement('span');
    toast.className = `toast ${type}`;
    toast.dataset.toast = String(++toastId);
    icon.classList.add('icon');
    icon.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', type === 'success' ? '#i-check' : type === 'error' ? '#i-close' : '#i-shield');
    icon.appendChild(use);
    text.textContent = message;
    toast.append(icon, text);
    dom['toast-region'].appendChild(toast);
    while (dom['toast-region'].children.length > 4) dom['toast-region'].firstElementChild.remove();
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(12px)';
      window.setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function storageWarning(message) {
    const now = Date.now();
    if (now - lastStorageWarning > 5000) {
      showToast(`${message} A partida continua na memória, mas pode não sobreviver ao fechamento desta aba.`, 'error', 8000);
      lastStorageWarning = now;
    }
    dom['save-status'].textContent = 'Falha no salvamento local';
  }

  function saveGame() {
    if (!game) return false;
    const saved = storage.saveCurrent(game);
    if (saved) dom['save-status'].textContent = 'Tudo salvo automaticamente neste navegador';
    return saved;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  function formatDate(iso) {
    try { return dateFormatter.format(new Date(iso)); } catch (error) { return 'Data indisponível'; }
  }

  function visibleDrawn() {
    if (!game) return [];
    return isDrawing ? game.drawn.slice(0, -1) : game.drawn;
  }

  function setBallTheme(element, number) {
    const info = letterFor(number);
    element.style.setProperty('--chip-color', info.color);
  }

  function renderBoard() {
    const drawn = visibleDrawn();
    const drawnSet = new Set(drawn);
    const latest = drawn.length ? drawn[drawn.length - 1] : null;
    boardBalls.forEach((ball, number) => {
      const isDrawn = drawnSet.has(number);
      ball.classList.toggle('is-drawn', isDrawn);
      ball.classList.toggle('is-latest', number === latest);
      ball.setAttribute('aria-label', `${letterFor(number).letter} ${pad(number)}, ${isDrawn ? 'sorteada' : 'disponível'}`);
    });
    LETTERS.forEach(item => {
      columnElements.get(item.letter).classList.toggle('is-active', latest >= item.min && latest <= item.max);
    });
    if (latest && !isDrawing && settings.animations) {
      const ball = boardBalls.get(latest);
      ball.classList.remove('just-drawn');
      // Força reinício apenas quando há uma nova revelação.
      if (ball.dataset.revealed !== String(drawn.length)) {
        void ball.offsetWidth;
        ball.classList.add('just-drawn');
        ball.dataset.revealed = String(drawn.length);
      }
    }
  }

  function renderCurrentBall() {
    const ball = dom['current-ball'];
    const drawn = game ? game.drawn : [];
    const current = drawn.length ? drawn[drawn.length - 1] : null;
    ball.classList.remove('drawing', 'revealed', 'empty');
    if (!current) {
      ball.classList.add('empty');
      ball.style.cssText = '';
      dom['current-letter'].textContent = 'BINGO';
      dom['current-number'].textContent = '—';
      dom['current-caption'].textContent = '75 BOLAS';
      ball.setAttribute('aria-live', 'polite');
      return;
    }
    const info = letterFor(current);
    ['--ball', '--ball-light', '--ball-dark', '--ball-rgb'].forEach((property, index) => {
      const value = [info.color, info.light, info.dark, info.rgb][index];
      ball.style.setProperty(property, value);
      dom['stage-panel'].style.setProperty(property, value);
    });
    if (isDrawing) {
      ball.classList.add('drawing');
      dom['current-letter'].textContent = 'SORTEANDO';
      dom['current-number'].textContent = String(secureRandomInt(1, TOTAL_BALLS)).padStart(2, '0');
      dom['current-caption'].textContent = 'MISTURANDO AS BOLAS';
      ball.setAttribute('aria-live', 'off');
    } else {
      ball.classList.add('revealed');
      dom['current-letter'].textContent = info.letter;
      dom['current-number'].textContent = pad(current);
      dom['current-caption'].textContent = 'BOLA SORTEADA';
      ball.setAttribute('aria-live', 'assertive');
    }
  }

  function createMiniBall(number, index, type, isLatest) {
    const chip = document.createElement('span');
    chip.className = type === 'recent' ? 'recent-ball' : 'history-ball';
    chip.classList.toggle('is-new', isLatest);
    setBallTheme(chip, number);
    if (type === 'recent') {
      chip.textContent = `${letterFor(number).letter}-${pad(number)}`;
      chip.title = `${index + 1}ª bola sorteada`;
    } else {
      const order = document.createElement('span');
      order.className = 'history-index';
      order.textContent = String(index + 1).padStart(2, '0');
      chip.append(order, document.createTextNode(`${letterFor(number).letter}-${pad(number)}`));
    }
    chip.setAttribute('aria-label', `${index + 1}ª bola: ${letterFor(number).letter} ${pad(number)}`);
    return chip;
  }

  function renderHistory() {
    const drawn = visibleDrawn();
    const recent = drawn.slice(-6).reverse();
    dom['recent-balls'].replaceChildren();
    if (!recent.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'history-placeholder';
      placeholder.textContent = 'O histórico aparecerá aqui';
      dom['recent-balls'].appendChild(placeholder);
    } else {
      recent.forEach((number, reverseIndex) => {
        const originalIndex = drawn.length - 1 - reverseIndex;
        dom['recent-balls'].appendChild(createMiniBall(number, originalIndex, 'recent', reverseIndex === 0));
      });
    }
    const displayedPrevious = isDrawing ? (drawn.length ? drawn[drawn.length - 1] : null) : (game ? game.previous : null);
    dom['previous-label'].textContent = `Anterior: ${displayedPrevious ? `${letterFor(displayedPrevious).letter}-${pad(displayedPrevious)}` : '—'}`;

    dom['full-history'].replaceChildren();
    if (!drawn.length) {
      const empty = document.createElement('span');
      empty.className = 'history-placeholder';
      empty.textContent = 'Nenhuma bola sorteada nesta partida.';
      dom['full-history'].appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      drawn.forEach((number, index) => fragment.appendChild(createMiniBall(number, index, 'history', index === drawn.length - 1)));
      dom['full-history'].appendChild(fragment);
    }
    dom['history-total'].textContent = `${drawn.length} ${drawn.length === 1 ? 'registro' : 'registros'}`;
  }

  function renderStats() {
    const count = visibleDrawn().length;
    const remaining = TOTAL_BALLS - count;
    const progress = Math.round(count / TOTAL_BALLS * 100);
    dom['board-count'].textContent = `${count} de ${TOTAL_BALLS} sorteadas`;
    dom['metric-drawn'].textContent = String(count);
    dom['metric-remaining'].textContent = String(remaining);
    dom['metric-progress'].textContent = `${progress}%`;
    dom['stat-drawn'].replaceChildren(document.createTextNode(String(count) + ' '));
    const total = document.createElement('small');
    total.textContent = '/ 75';
    dom['stat-drawn'].appendChild(total);
    dom['stat-rounds'].textContent = String(count);
    dom['stat-progress'].textContent = `${progress}%`;
    dom['stat-progress-bar'].style.width = `${progress}%`;
    dom['stat-remaining'].textContent = `${remaining} ${remaining === 1 ? 'bola ainda disponível' : 'bolas ainda disponíveis'}`;
    dom['stat-time'].textContent = formatDuration(game ? game.getElapsed() : 0);
  }

  function renderStatus() {
    const status = game ? game.status : 'none';
    const statusElement = dom['session-status'];
    statusElement.className = 'session-status';
    dom['live-badge'].className = 'live-badge';
    if (!game) {
      dom['session-status-text'].textContent = 'Sistema pronto';
      dom['session-id'].textContent = 'NOVA PARTIDA';
      dom['live-badge'].querySelector('span').textContent = 'AGUARDANDO';
      dom['draw-label'].textContent = 'Pronto para o primeiro sorteio';
      dom['draw-subtitle'].textContent = 'Toque em “Iniciar jogo” para começar';
    } else {
      dom['session-status-text'].textContent = statusNames[status];
      dom['session-id'].textContent = game.id;
      const current = game.current ? `${letterFor(game.current).letter}-${pad(game.current)}` : null;
      if (status === 'ready') {
        dom['draw-label'].textContent = 'Partida preparada';
        dom['draw-subtitle'].textContent = game.auto ? 'O sorteio automático começará ao iniciar' : 'Modo manual selecionado';
        dom['live-badge'].querySelector('span').textContent = 'PRONTO';
      } else if (status === 'running') {
        statusElement.classList.add('is-live');
        dom['live-badge'].classList.add('is-live');
        dom['live-badge'].querySelector('span').textContent = game.auto ? 'AO VIVO' : 'MODO MANUAL';
        dom['draw-label'].textContent = current ? `${current} • Bola sorteada` : 'Partida em andamento';
        dom['draw-subtitle'].textContent = game.auto ? `Próxima bola em ${game.interval} segundos` : 'Use “Sortear próxima bola” quando estiver pronto';
      } else if (status === 'drawing') {
        statusElement.classList.add('is-live');
        dom['live-badge'].classList.add('is-live');
        dom['live-badge'].querySelector('span').textContent = 'SORTEANDO';
        dom['draw-label'].textContent = 'A urna está girando…';
        dom['draw-subtitle'].textContent = 'Aguarde a revelação da próxima bola';
      } else if (status === 'paused') {
        statusElement.classList.add('is-paused');
        dom['live-badge'].classList.add('is-paused');
        dom['live-badge'].querySelector('span').textContent = 'PAUSADO';
        dom['draw-label'].textContent = isDrawing ? 'Revelando a bola sorteada…' : 'Partida pausada';
        dom['draw-subtitle'].textContent = isDrawing ? 'O número será confirmado antes da pausa completa' : 'O tabuleiro e o histórico estão preservados';
      } else if (status === 'finished') {
        statusElement.classList.add('is-finished');
        dom['live-badge'].querySelector('span').textContent = 'FINALIZADO';
        dom['draw-label'].textContent = game.endReason === 'all-drawn' ? 'Todas as 75 bolas foram sorteadas' : 'Partida finalizada e preservada';
        dom['draw-subtitle'].textContent = 'Use “Recuperar” para revisar ou reabrir esta partida';
      }
    }
  }

  function renderControls() {
    const status = game ? game.status : 'none';
    const remaining = game ? game.remaining : TOTAL_BALLS;
    dom['btn-start'].disabled = Boolean(game && status !== 'ready') || isDrawing;
    dom['btn-pause'].disabled = !['running', 'drawing'].includes(status);
    dom['btn-continue'].disabled = status !== 'paused' || isDrawing || remaining === 0;
    dom['btn-next'].disabled = !game || status === 'finished' || isDrawing || remaining === 0;
    dom['btn-finish'].disabled = !game || status === 'ready' || status === 'finished' || isDrawing || (game && !game.drawn.length);
    dom['btn-next'].title = status === 'paused' ? 'Sorteia uma bola e mantém a partida pausada' : 'Sortear agora, sem repetição';
  }

  function renderCountdown() {
    const countdown = dom['countdown-wrap'];
    countdown.classList.remove('is-running');
    if (!game || game.status === 'ready') {
      dom['countdown-label'].textContent = game && game.auto ? 'INTERVALO CONFIGURADO' : 'SORTEIO MANUAL';
      dom['countdown-value'].textContent = game && game.auto ? `${game.interval} segundos entre bolas` : 'Automático desligado';
      dom['timer-progress'].style.width = '0%';
      dom['timer-track'].setAttribute('aria-valuenow', '0');
      return;
    }
    if (isDrawing) {
      dom['countdown-label'].textContent = 'SORTEIO EM CURSO';
      dom['countdown-value'].textContent = 'Revelando a bola…';
      dom['timer-progress'].style.width = '100%';
      return;
    }
    if (game.status === 'finished') {
      dom['countdown-label'].textContent = 'PARTIDA ENCERRADA';
      dom['countdown-value'].textContent = `${game.drawn.length} bolas preservadas`;
      dom['timer-progress'].style.width = '0%';
      return;
    }
    if (!game.auto) {
      dom['countdown-label'].textContent = 'SORTEIO MANUAL';
      dom['countdown-value'].textContent = game.status === 'paused' ? 'Partida pausada' : 'Automático desligado';
      dom['timer-progress'].style.width = '0%';
      return;
    }
    const now = Date.now();
    const remainingMs = game.timer.deadline ? Math.max(0, game.timer.deadline - now) : Math.max(0, game.timer.remainingMs);
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const percent = clampPercent(remainingMs / Math.max(1, game.timer.durationMs) * 100);
    dom['timer-progress'].style.width = `${percent}%`;
    dom['timer-track'].setAttribute('aria-valuenow', String(Math.round(percent)));
    if (game.status === 'paused') {
      dom['countdown-label'].textContent = 'CONTAGEM PAUSADA';
      dom['countdown-value'].textContent = `${seconds}s restantes para a próxima bola`;
    } else {
      countdown.classList.add('is-running');
      dom['countdown-label'].textContent = 'PRÓXIMO SORTEIO';
      dom['countdown-value'].textContent = `em ${pad(seconds)} segundo${seconds === 1 ? '' : 's'}`;
    }
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  function renderAll() {
    renderBoard();
    renderCurrentBall();
    renderHistory();
    renderStats();
    renderStatus();
    renderControls();
    renderCountdown();
  }

  function preserveCurrentBeforeReplacement() {
    const current = game || (savedSlots.current && savedSlots.current.game);
    if (!current) return true;
    const preserved = storage.preserveBeforeReplacement(current);
    if (!preserved) showToast('Novo jogo cancelado: não foi possível garantir o backup da partida atual.', 'error', 7000);
    return preserved;
  }

  function prepareNewGame(autoStart = false) {
    if (!preserveCurrentBeforeReplacement()) return false;
    game = new BingoGame(settings);
    tieData = makeTie();
    storage.saveTie(tieData);
    saveGame();
    savedSlots = storage.slots();
    renderAll();
    if (autoStart) beginReadyGame();
    else showToast('Nova partida preparada. A anterior foi preservada no backup.', 'success');
    return true;
  }

  function beginReadyGame() {
    if (!game) {
      prepareNewGame(true);
      return;
    }
    if (game.status !== 'ready') return;
    game.begin(Date.now());
    game.timer.remainingMs = game.interval * 1000;
    game.timer.durationMs = game.interval * 1000;
    saveGame();
    sound.play('start');
    renderAll();
    if (game.auto) startDraw('auto');
    else showToast('Partida iniciada no modo manual. Use “Sortear próxima bola”.', 'success');
  }

  function startDraw(origin = 'manual') {
    if (!game || isDrawing || tieRunning) return false;
    if (game.status === 'finished') {
      showToast('A partida está finalizada. Recupere-a para continuar.', 'warning');
      return false;
    }
    if (!game.deck.length) {
      showToast('Todas as 75 bolas já foram sorteadas.', 'warning');
      return false;
    }
    if (game.status === 'ready') game.begin(Date.now());
    drawReturnStatus = game.status === 'paused' ? 'paused' : 'running';
    try {
      const clock = Date.now();
      game.drawNext(clock);
      isDrawing = true;
      // A transação é salva antes da animação; atualizar a página não perde a bola.
      saveGame();
      sound.play('rolling');
      renderAll();
      const durations = { slow: 1400, normal: 900, fast: 450 };
      const duration = settings.animations ? durations[settings.speed] : 0;
      if (rollingInterval) clearInterval(rollingInterval);
      if (duration > 0) {
        rollingInterval = window.setInterval(() => {
          dom['current-number'].textContent = pad(secureRandomInt(1, TOTAL_BALLS));
        }, 85);
      }
      drawTimeout = window.setTimeout(() => revealDrawnBall(origin), duration);
      return true;
    } catch (error) {
      isDrawing = false;
      showToast(error.message, 'error');
      renderAll();
      return false;
    }
  }

  function revealDrawnBall() {
    if (!game || !isDrawing) return;
    clearTimeout(drawTimeout);
    clearInterval(rollingInterval);
    drawTimeout = null;
    rollingInterval = null;
    game.completeDraw(Date.now());
    if (drawReturnStatus === 'paused' && game.status === 'running') game.pause(Date.now());
    isDrawing = false;
    sound.play('reveal');
    saveGame();
    renderAll();
    if (game.status === 'finished' && game.endReason === 'all-drawn') {
      storage.saveFinished(game);
      savedSlots = storage.slots();
      sound.play('finish');
      showToast('Partida completa: 75 bolas sorteadas sem repetição. Registro finalizado preservado.', 'success', 7000);
    }
  }

  function pauseGame(withSound = true) {
    if (!game || !['running', 'drawing'].includes(game.status)) return false;
    if (game.pause(Date.now())) {
      if (isDrawing) drawReturnStatus = 'paused';
      saveGame();
      if (withSound) sound.play('pause');
      renderAll();
      return true;
    }
    return false;
  }

  function continueGame() {
    if (!game || game.status !== 'paused' || isDrawing) return;
    if (game.continue(Date.now())) {
      saveGame();
      sound.play('start');
      renderAll();
      showToast('Partida retomada do ponto em que foi pausada.', 'success', 2600);
    }
  }

  function finishGame() {
    if (!game || !game.drawn.length) return;
    game.finish(Date.now(), 'operator');
    // O último finalizado é atualizado antes de encerrar a exibição da partida.
    storage.saveFinished(game);
    saveGame();
    savedSlots = storage.slots();
    sound.play('finish');
    renderAll();
    showToast('Partida finalizada. O estado completo foi salvo e pode ser recuperado.', 'success', 6500);
  }

  function askConfirm(title, message, acceptLabel = 'Confirmar', danger = true) {
    if (confirmResolve) return Promise.resolve(false);
    dom['confirm-title'].textContent = title;
    dom['confirm-message'].textContent = message;
    dom['confirm-accept'].textContent = acceptLabel;
    dom['confirm-accept'].className = `button ${danger ? 'button-danger' : 'button-primary'}`;
    dom['confirm-dialog'].showModal();
    return new Promise(resolve => { confirmResolve = resolve; });
  }

  function settleConfirm(value) {
    if (!confirmResolve) return;
    const resolve = confirmResolve;
    confirmResolve = null;
    dom['confirm-dialog'].close();
    resolve(value);
  }

  async function handleNewGame() {
    if (isDrawing) {
      showToast('Aguarde a revelação da bola antes de criar outro jogo.', 'warning');
      return;
    }
    const hasProgress = game && (game.drawn.length > 0 || ['running', 'paused', 'finished'].includes(game.status));
    const mustConfirm = hasProgress || settings.confirmNew;
    if (mustConfirm) {
      const detail = hasProgress
        ? `A partida ${game.id}, com ${game.drawn.length} bolas sorteadas, será movida para o backup antes de criar a nova.`
        : 'O tabuleiro será preparado com 75 novas bolas. Nenhum backup existente será apagado.';
      const accepted = await askConfirm('Criar um novo jogo?', `${detail}\n\nDeseja continuar?`, 'Criar novo jogo');
      if (!accepted) return;
    }
    prepareNewGame(false);
  }

  async function handleStart() {
    if (!game) {
      const hasSavedCurrent = Boolean(savedSlots.current);
      if (hasSavedCurrent) {
        const accepted = await askConfirm('Iniciar outra partida?', 'Há uma partida salva que não foi restaurada automaticamente. Ela será preservada no backup antes de iniciar.', 'Preservar e iniciar');
        if (!accepted) return;
      }
      prepareNewGame(true);
      return;
    }
    if (game.status === 'ready') beginReadyGame();
  }

  function openSettings() {
    populateSettingsForm();
    dom['settings-dialog'].showModal();
    window.setTimeout(() => $('#setting-interval').focus(), 30);
  }

  function populateSettingsForm() {
    const standard = [5, 8, 10, 15, 20, 30];
    $('#setting-interval').value = standard.includes(settings.interval) ? String(settings.interval) : 'custom';
    $('#setting-custom-interval').value = String(settings.interval);
    $('#custom-interval-row').hidden = standard.includes(settings.interval);
    $('#setting-auto').checked = settings.auto;
    $('#setting-sound').checked = settings.sound;
    $('#setting-volume').value = String(settings.volume);
    $('#volume-value').textContent = `${settings.volume}%`;
    $('#setting-animations').checked = settings.animations;
    $('#setting-speed').value = settings.speed;
    $('#setting-theme').value = settings.theme;
    $('#setting-history').checked = settings.showHistory;
    $('#setting-confirm').checked = settings.confirmNew;
    $('#setting-recovery').checked = settings.autoRecovery;
  }

  function applySettingsFromForm() {
    const preset = $('#setting-interval').value;
    const customInput = $('#setting-custom-interval');
    const customValue = Number(customInput.value);
    if (preset === 'custom' && (!Number.isFinite(customValue) || customValue < 1 || customValue > 300)) {
      customInput.setCustomValidity('Informe um valor entre 1 e 300 segundos.');
      customInput.reportValidity();
      return;
    }
    customInput.setCustomValidity('');
    const interval = preset === 'custom' ? Math.round(customValue) : Number(preset);
    const next = {
      ...settings,
      interval,
      customInterval: preset === 'custom' ? interval : settings.customInterval,
      intervalPreset: preset,
      auto: $('#setting-auto').checked,
      sound: $('#setting-sound').checked,
      volume: Number($('#setting-volume').value),
      animations: $('#setting-animations').checked,
      speed: $('#setting-speed').value,
      theme: $('#setting-theme').value,
      showHistory: $('#setting-history').checked,
      confirmNew: $('#setting-confirm').checked,
      autoRecovery: $('#setting-recovery').checked
    };
    settings = window.Bingo75.normalizeSettings(next);
    applySettings();
    if (game) {
      game.updateTiming(settings.interval, settings.auto, Date.now());
      saveGame();
    }
    storage.saveSettings(settings);
    renderAll();
  }

  function applySettings() {
    document.body.dataset.theme = settings.theme;
    document.body.dataset.speed = settings.speed;
    document.body.classList.toggle('no-animations', !settings.animations);
    dom['history-panel'].hidden = !settings.showHistory;
    sound.configure(settings);
  }

  function openRecovery() {
    if (isDrawing) {
      showToast('Aguarde a revelação da bola para abrir a recuperação.', 'warning');
      return;
    }
    savedSlots = storage.slots();
    renderRecoveryOptions();
    dom['recovery-dialog'].showModal();
  }

  function describeRecovery(slot, key) {
    const labels = { current: 'Jogo atual', backup: 'Backup automático', finished: 'Último jogo finalizado' };
    const card = document.createElement('article');
    const top = document.createElement('div');
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    const time = document.createElement('time');
    const badge = document.createElement('span');
    const details = document.createElement('div');
    const button = document.createElement('button');
    card.className = `recovery-card ${key}`;
    top.className = 'recovery-card-top';
    title.textContent = labels[key];
    time.textContent = `Iniciada em ${formatDate(slot.game.startedAt)} • salva em ${formatDate(slot.savedAt)}`;
    time.dateTime = slot.savedAt;
    titleWrap.append(title, time);
    badge.className = 'recovery-badge';
    badge.textContent = statusNames[slot.game.status];
    top.append(titleWrap, badge);
    details.className = 'recovery-details';
    [
      ['Números sorteados', `${slot.game.drawn.length} de 75`],
      ['Último número', slot.game.current ? `${letterFor(slot.game.current).letter}-${pad(slot.game.current)}` : 'Nenhum'],
      ['Identificador', slot.game.id]
    ].forEach(([label, value]) => {
      const wrap = document.createElement('div');
      const caption = document.createElement('span');
      const strong = document.createElement('strong');
      caption.textContent = label;
      strong.textContent = value;
      strong.title = value;
      wrap.append(caption, strong);
      details.appendChild(wrap);
    });
    button.className = 'button button-primary';
    button.type = 'button';
    button.dataset.restore = key;
    button.textContent = slot.game.status === 'finished' && dom['recovery-reopen'].checked ? 'Restaurar e reabrir partida' : 'Restaurar partida';
    card.append(top, details, button);
    return card;
  }

  function renderRecoveryOptions() {
    dom['recovery-options'].replaceChildren();
    let count = 0;
    ['current', 'backup', 'finished'].forEach(key => {
      const slot = savedSlots[key];
      if (slot) {
        dom['recovery-options'].appendChild(describeRecovery(slot, key));
        count += 1;
      }
    });
    if (!count) {
      const empty = document.createElement('p');
      empty.className = 'empty-recovery';
      empty.textContent = 'Nenhuma partida salva ainda. Inicie um jogo para ativar os backups automáticos.';
      dom['recovery-options'].appendChild(empty);
    }
    dom['reopen-option'].hidden = !Object.values(savedSlots).some(slot => slot && slot.game.status === 'finished');
  }

  async function restoreSlot(key) {
    const selected = savedSlots[key];
    if (!selected) return;
    const reopen = selected.game.status === 'finished' && dom['recovery-reopen'].checked;
    const current = game || (savedSlots.current && savedSlots.current.game);
    const accepted = await askConfirm(
      'Restaurar esta partida?',
      `${selected.game.drawn.length} bolas e todo o histórico da partida ${selected.game.id} serão restaurados.\n\n${current ? 'A versão atual será preservada no backup antes da substituição.' : 'Nenhuma partida aberta será substituída.'}${reopen ? '\n\nA cópia finalizada será reaberta como pausada.' : ''}`,
      'Restaurar partida',
      false
    );
    if (!accepted) return;
    if (!preserveCurrentBeforeReplacement()) return;
    try {
      const restored = validateGame(clone(selected.game));
      if (reopen) {
        restored.status = 'paused';
        restored.endedAt = null;
        restored.endReason = null;
        restored.activeSince = null;
        restored.timer.deadline = null;
        restored.timer.remainingMs = restored.interval * 1000;
        restored.recoveredAt = nowIso();
        restored.updatedAt = restored.recoveredAt;
      } else {
        restored.recoverForOpening(Date.now());
      }
      game = restored;
      tieData = normalizeTie(game.tie);
      storage.saveTie(tieData);
      saveGame();
      savedSlots = storage.slots();
      renderAll();
      dom['recovery-dialog'].close();
      showToast(`Partida ${game.id} restaurada com ${game.drawn.length} bolas. O sorteio está pausado para sua segurança.`, 'success', 6500);
    } catch (error) {
      showToast(`Não foi possível restaurar: ${error.message}`, 'error', 7000);
    }
  }

  async function enterProjection() {
    if (dom['settings-dialog'].open) dom['settings-dialog'].close();
    projectionRequested = true;
    document.body.classList.add('projection');
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      showToast('O navegador não liberou a tela cheia. O modo telão ampliado continua ativo.', 'warning', 5000);
    }
  }

  async function exitProjection() {
    projectionRequested = false;
    document.body.classList.remove('projection');
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch (error) {
      showToast('Saída da tela cheia controlada pelo navegador.', 'warning');
    }
  }

  function toggleProjection() {
    if (document.body.classList.contains('projection')) exitProjection();
    else enterProjection();
  }

  /* -------------------------- Pedra Maior -------------------------- */
  function openTie() {
    if (isDrawing) {
      showToast('Conclua a revelação da bola antes de abrir a Pedra Maior.', 'warning');
      return;
    }
    if (game && game.status === 'running') {
      pauseGame(false);
      showToast('Bingo principal pausado. A Pedra Maior não altera nenhuma bola.', 'warning', 4500);
    }
    renderTie();
    dom['tie-dialog'].showModal();
    if (!tieData.winnerId) window.setTimeout(() => dom['competitor-name'].focus(), 50);
  }

  function persistTie() {
    tieData.updatedAt = nowIso();
    storage.saveTie(tieData);
    if (game) {
      game.tie = clone(tieData);
      saveGame();
    }
  }

  function renderTie() {
    dom['competitor-list'].replaceChildren();
    if (!tieData.participants.length) {
      const empty = document.createElement('span');
      empty.className = 'competitor-empty';
      empty.textContent = 'Nenhum participante adicionado.';
      dom['competitor-list'].appendChild(empty);
    } else {
      tieData.participants.forEach((person, index) => {
        const chip = document.createElement('span');
        const number = document.createElement('span');
        const name = document.createElement('span');
        const remove = document.createElement('button');
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        chip.className = 'competitor-chip';
        number.className = 'competitor-number';
        number.textContent = pad(index + 1);
        name.className = 'competitor-name';
        name.textContent = person.name;
        name.title = person.name;
        remove.type = 'button';
        remove.dataset.removeCompetitor = person.id;
        remove.setAttribute('aria-label', `Remover ${person.name}`);
        remove.disabled = tieRunning;
        icon.classList.add('icon');
        use.setAttribute('href', '#i-trash');
        icon.appendChild(use);
        remove.appendChild(icon);
        chip.append(number, name, remove);
        dom['competitor-list'].appendChild(chip);
      });
    }
    const count = tieData.participants.length;
    dom['tie-count'].textContent = `${count} ${count === 1 ? 'participante' : 'participantes'}`;
    dom['competitor-name'].disabled = tieRunning;
    dom['competitor-form'].querySelector('button').disabled = tieRunning;
    const winner = tieData.participants.find(person => person.id === tieData.winnerId);
    dom['tie-arena'].classList.toggle('has-winner', Boolean(winner));
    dom['tie-arena'].classList.toggle('is-drawing', tieRunning);
    dom['btn-tie-repeat'].hidden = !winner || tieRunning;
    dom['btn-tie-draw'].hidden = Boolean(winner);
    dom['btn-tie-draw'].disabled = count < 2 || tieRunning;
    dom['tie-dialog'].querySelector('[data-close="tie-dialog"]').disabled = tieRunning;
    if (tieRunning) {
      dom['tie-overline'].textContent = 'A PEDRA MAIOR ESTÁ GIRANDO';
      dom['tie-result-caption'].textContent = 'Sorteio exclusivo e imparcial em andamento…';
    } else if (winner) {
      dom['tie-overline'].textContent = 'VENCEDOR DA PEDRA MAIOR';
      dom['tie-name-display'].textContent = winner.name;
      dom['tie-result-caption'].textContent = `Resultado confirmado • ${formatDate(tieData.draws.length ? tieData.draws[tieData.draws.length - 1].at : nowIso())}`;
    } else {
      dom['tie-overline'].textContent = 'CONCORRENTES NA DISPUTA';
      dom['tie-name-display'].textContent = count ? `${count} participantes na disputa` : 'Aguardando participantes';
      dom['tie-result-caption'].textContent = count < 2 ? 'Adicione pelo menos 2 nomes para iniciar o desempate.' : 'Tudo pronto. Faça o sorteio quando o operador autorizar.';
    }
  }

  async function clearTieResultForEdit() {
    if (!tieData.winnerId) return true;
    const accepted = await askConfirm('Alterar este desempate?', 'Já existe um vencedor. Para editar os participantes ou repetir, o resultado exibido será reiniciado. O registro do sorteio anterior será mantido.', 'Reiniciar desempate');
    if (accepted) {
      tieData.winnerId = null;
      persistTie();
      renderTie();
    }
    return accepted;
  }

  async function addCompetitor(event) {
    event.preventDefault();
    if (tieRunning) return;
    const name = dom['competitor-name'].value.trim().replace(/\s+/g, ' ');
    dom['competitor-error'].textContent = '';
    if (name.length < 2) {
      dom['competitor-error'].textContent = 'Informe um nome com pelo menos 2 caracteres.';
      return;
    }
    if (tieData.participants.some(person => person.name.localeCompare(name, 'pt-BR', { sensitivity: 'base' }) === 0)) {
      dom['competitor-error'].textContent = 'Este nome já está na disputa. Acrescente uma identificação para diferenciá-lo.';
      return;
    }
    if (tieData.participants.length >= 100) {
      dom['competitor-error'].textContent = 'Limite de 100 participantes por desempate.';
      return;
    }
    if (!(await clearTieResultForEdit())) return;
    tieData.participants.push({ id: window.Bingo75.makeId('P'), name: name.slice(0, 60) });
    dom['competitor-name'].value = '';
    persistTie();
    renderTie();
    dom['competitor-name'].focus();
  }

  async function removeCompetitor(id) {
    if (tieRunning) return;
    if (!(await clearTieResultForEdit())) return;
    tieData.participants = tieData.participants.filter(person => person.id !== id);
    tieData.winnerId = null;
    persistTie();
    renderTie();
  }

  async function repeatTie() {
    if (tieRunning || !tieData.winnerId) return;
    if (!(await clearTieResultForEdit())) return;
    drawTieWinner();
  }

  function drawTieWinner() {
    if (tieRunning || tieData.participants.length < 2 || tieData.winnerId) return;
    tieRunning = true;
    const winnerIndex = secureRandomInt(0, tieData.participants.length - 1);
    const winner = tieData.participants[winnerIndex];
    sound.play('tie');
    renderTie();
    const duration = settings.animations ? (settings.speed === 'slow' ? 3600 : settings.speed === 'fast' ? 1500 : 2500) : 150;
    if (tieNameInterval) clearInterval(tieNameInterval);
    tieNameInterval = window.setInterval(() => {
      const index = secureRandomInt(0, tieData.participants.length - 1);
      dom['tie-name-display'].textContent = tieData.participants[index].name;
    }, 90);
    tieTimeout = window.setTimeout(() => {
      clearInterval(tieNameInterval);
      tieNameInterval = null;
      tieRunning = false;
      tieData.winnerId = winner.id;
      tieData.draws.push({ winnerId: winner.id, winnerName: winner.name, at: nowIso() });
      tieData.draws = tieData.draws.slice(-50);
      persistTie();
      renderTie();
      sound.play('win');
      showToast(`Pedra Maior: ${winner.name} venceu o desempate.`, 'success', 6000);
    }, duration);
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
  }

  async function handleAction(action) {
    switch (action) {
      case 'start': await handleStart(); break;
      case 'pause': pauseGame(); break;
      case 'continue': continueGame(); break;
      case 'next': startDraw('manual'); break;
      case 'new': await handleNewGame(); break;
      case 'finish': {
        if (!game || isDrawing) return;
        const accepted = await askConfirm('Finalizar esta partida?', `A partida ${game.id} será encerrada com ${game.drawn.length} bolas sorteadas.\n\nO histórico completo será salvo no último jogo finalizado e poderá ser recuperado.`, 'Finalizar jogo');
        if (accepted) finishGame();
        break;
      }
      case 'recover': openRecovery(); break;
      case 'settings': openSettings(); break;
      case 'projection': case 'projection-exit': await toggleProjection(); break;
      case 'tie': openTie(); break;
      default: break;
    }
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const actionButton = event.target.closest('[data-action]');
      if (actionButton && !actionButton.disabled) {
        handleAction(actionButton.dataset.action).catch(error => showToast(error.message, 'error'));
        return;
      }
      const closeButton = event.target.closest('[data-close]');
      if (closeButton && !closeButton.disabled) closeDialog(closeButton.dataset.close);
      const restoreButton = event.target.closest('[data-restore]');
      if (restoreButton) restoreSlot(restoreButton.dataset.restore).catch(error => showToast(error.message, 'error'));
      const removeButton = event.target.closest('[data-remove-competitor]');
      if (removeButton && !removeButton.disabled) removeCompetitor(removeButton.dataset.removeCompetitor);
    });

    dom['confirm-accept'].addEventListener('click', () => settleConfirm(true));
    dom['confirm-cancel'].addEventListener('click', () => settleConfirm(false));
    dom['confirm-dialog'].addEventListener('cancel', event => {
      event.preventDefault();
      settleConfirm(false);
    });
    dom['tie-dialog'].addEventListener('cancel', event => {
      if (tieRunning) {
        event.preventDefault();
        showToast('Aguarde a revelação do vencedor antes de fechar.', 'warning');
      }
    });
    dom['competitor-form'].addEventListener('submit', addCompetitor);
    dom['btn-tie-draw'].addEventListener('click', drawTieWinner);
    dom['btn-tie-repeat'].addEventListener('click', repeatTie);
    dom['recovery-reopen'].addEventListener('change', renderRecoveryOptions);

    const settingsInputs = $$('#settings-form input, #settings-form select');
    settingsInputs.forEach(input => {
      input.addEventListener(input.type === 'range' || input.id === 'setting-custom-interval' ? 'input' : 'change', () => {
        if (input.id === 'setting-interval') $('#custom-interval-row').hidden = input.value !== 'custom';
        if (input.id === 'setting-volume') $('#volume-value').textContent = `${input.value}%`;
        applySettingsFromForm();
      });
    });

    document.addEventListener('keydown', event => {
      const tag = event.target && event.target.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable) return;
      const openDialog = document.querySelector('dialog[open]');
      if (event.key === 'Escape' && document.body.classList.contains('projection') && !openDialog) {
        event.preventDefault();
        exitProjection();
        return;
      }
      if (openDialog || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!game) handleStart();
        else if (game.status === 'ready') beginReadyGame();
        else startDraw('manual');
      } else if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (game && game.status === 'paused') continueGame();
        else pauseGame();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleProjection();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && projectionRequested && document.body.classList.contains('projection')) {
        projectionRequested = false;
        document.body.classList.remove('projection');
      }
    });

    window.addEventListener('pagehide', () => { if (game) storage.saveCurrent(game); });
    window.addEventListener('beforeunload', () => { if (game) storage.saveCurrent(game); });
    window.addEventListener('storage', event => {
      if (Object.values(KEYS).includes(event.key)) {
        dom['save-status'].textContent = 'Outra aba alterou os dados locais — recupere para revisar';
      }
    });
  }

  function tick() {
    const now = Date.now();
    if (game && game.status === 'running' && game.auto && !isDrawing && !tieRunning && game.timer.deadline) {
      const anyDialog = document.querySelector('dialog[open]');
      if (!anyDialog && now >= game.timer.deadline) startDraw('auto');
    }
    renderCountdown();
    if (now - lastClockRender >= 500) {
      dom['stat-time'].textContent = formatDuration(game ? game.getElapsed(now) : 0);
      lastClockRender = now;
    }
  }

  function initialize() {
    cacheDom();
    buildBoard();
    storage = new BingoStorage(storageWarning);
    settings = storage.loadSettings();
    sound = new SoundManager(settings);
    savedSlots = storage.slots();
    tieData = storage.loadTie();
    applySettings();

    if (savedSlots.current && settings.autoRecovery) {
      game = savedSlots.current.game;
      const wasActive = ['running', 'drawing'].includes(game.status);
      if (wasActive) {
        game.recoverForOpening(Date.now());
        saveGame();
      }
      tieData = normalizeTie(game.tie);
      if (wasActive) {
        window.setTimeout(() => showToast(`Partida ${game.id} recuperada automaticamente e pausada com segurança. Toque em Continuar.`, 'success', 7000), 350);
      }
    }

    bindEvents();
    renderAll();
    populateSettingsForm();
    window.setInterval(tick, 100);
    if (!storage.available) storageWarning('O armazenamento local não está disponível.');
  }

  initialize();
})();
