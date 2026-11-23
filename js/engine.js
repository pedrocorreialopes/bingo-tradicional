/*
 * Bingo 75 — motor de jogo, relógio e persistência.
 * Este arquivo não depende do DOM e pode ser testado isoladamente.
 */
(function (global) {
  'use strict';

  const TOTAL_BALLS = 75;
  const SCHEMA_VERSION = 1;
  const KEYS = Object.freeze({
    settings: 'bingo75.settings.v1',
    current: 'bingo75.current.v1',
    backup: 'bingo75.backup.v1',
    finished: 'bingo75.finished.v1',
    tie: 'bingo75.tie.v1'
  });
  const LETTERS = Object.freeze([
    { letter: 'B', min: 1, max: 15, color: '#3c8dff', light: '#8fc4ff', dark: '#164aab', rgb: '60, 141, 255' },
    { letter: 'I', min: 16, max: 30, color: '#f05268', light: '#ff9eaa', dark: '#a71f3a', rgb: '240, 82, 104' },
    { letter: 'N', min: 31, max: 45, color: '#f4bc3e', light: '#ffe497', dark: '#a76408', rgb: '244, 188, 62' },
    { letter: 'G', min: 46, max: 60, color: '#36c98f', light: '#94f0c7', dark: '#08754c', rgb: '54, 201, 143' },
    { letter: 'O', min: 61, max: 75, color: '#a773f4', light: '#d8b9ff', dark: '#6130a6', rgb: '167, 115, 244' }
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    interval: 10,
    auto: true,
    sound: true,
    volume: 60,
    animations: true,
    speed: 'normal',
    theme: 'navy',
    showHistory: true,
    confirmNew: true,
    autoRecovery: true
  });

  function letterFor(number) {
    return LETTERS[Math.min(4, Math.floor((number - 1) / 15))];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isValidDate(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    const date = new Date();
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const suffix = secureRandomInt(0, 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    return `${prefix || 'B75'}-${stamp}-${suffix}`;
  }

  /* Inteiro imparcial sem viés de módulo. Usa Web Crypto quando disponível. */
  function secureRandomInt(min, maxInclusive) {
    const minValue = Math.ceil(Number(min));
    const maxValue = Math.floor(Number(maxInclusive));
    if (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue) || maxValue < minValue) {
      throw new RangeError('Intervalo aleatório inválido.');
    }
    const range = maxValue - minValue + 1;
    if (range === 1) return minValue;
    const cryptoApi = global.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function' && range <= 0x100000000) {
      const maxUint = 0x100000000;
      const acceptanceLimit = Math.floor(maxUint / range) * range;
      const buffer = new Uint32Array(1);
      do {
        cryptoApi.getRandomValues(buffer);
      } while (buffer[0] >= acceptanceLimit);
      return minValue + (buffer[0] % range);
    }
    // Fallback para navegadores antigos: o embaralhamento continua uniforme na prática.
    return minValue + Math.floor(Math.random() * range);
  }

  function shuffledBalls() {
    const balls = Array.from({ length: TOTAL_BALLS }, (_, index) => index + 1);
    // Fisher–Yates: cada permutação tem a mesma oportunidade de ocorrer.
    for (let index = balls.length - 1; index > 0; index -= 1) {
      const target = secureRandomInt(0, index);
      [balls[index], balls[target]] = [balls[target], balls[index]];
    }
    return balls;
  }

  function normalizeSettings(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const standardIntervals = [5, 8, 10, 15, 20, 30];
    const rawInterval = Number(source.interval);
    return {
      interval: Number.isFinite(rawInterval) ? clamp(Math.round(rawInterval), 1, 300) : DEFAULT_SETTINGS.interval,
      customInterval: Number.isFinite(Number(source.customInterval)) ? clamp(Math.round(Number(source.customInterval)), 1, 300) : 12,
      intervalPreset: standardIntervals.includes(rawInterval) ? String(rawInterval) : 'custom',
      auto: typeof source.auto === 'boolean' ? source.auto : DEFAULT_SETTINGS.auto,
      sound: typeof source.sound === 'boolean' ? source.sound : DEFAULT_SETTINGS.sound,
      volume: Number.isFinite(Number(source.volume)) ? clamp(Math.round(Number(source.volume)), 0, 100) : DEFAULT_SETTINGS.volume,
      animations: typeof source.animations === 'boolean' ? source.animations : DEFAULT_SETTINGS.animations,
      speed: ['slow', 'normal', 'fast'].includes(source.speed) ? source.speed : DEFAULT_SETTINGS.speed,
      theme: ['navy', 'graphite', 'eclipse'].includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
      showHistory: typeof source.showHistory === 'boolean' ? source.showHistory : DEFAULT_SETTINGS.showHistory,
      confirmNew: typeof source.confirmNew === 'boolean' ? source.confirmNew : DEFAULT_SETTINGS.confirmNew,
      autoRecovery: typeof source.autoRecovery === 'boolean' ? source.autoRecovery : DEFAULT_SETTINGS.autoRecovery
    };
  }

  function normalizeTie(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const participants = Array.isArray(source.participants) ? source.participants.slice(0, 100).map((person, index) => ({
      id: typeof person.id === 'string' ? person.id : `P${index + 1}-${secureRandomInt(0, 999999)}`,
      name: String(person.name || '').trim().slice(0, 60)
    })).filter(person => person.name) : [];
    const draws = Array.isArray(source.draws) ? source.draws.slice(-50).filter(item => item && typeof item.winnerName === 'string').map(item => ({
      winnerId: String(item.winnerId || ''),
      winnerName: item.winnerName.slice(0, 60),
      at: isValidDate(item.at) ? item.at : nowIso()
    })) : [];
    const winnerId = participants.some(person => person.id === source.winnerId) ? source.winnerId : null;
    return { participants, winnerId, draws, updatedAt: isValidDate(source.updatedAt) ? source.updatedAt : null };
  }

  function makeTie() {
    return normalizeTie(null);
  }

  function emptyTimer(interval) {
    return { remainingMs: interval * 1000, durationMs: interval * 1000, deadline: null };
  }

  class BingoGame {
    constructor(settings) {
      const config = normalizeSettings(settings);
      this.version = SCHEMA_VERSION;
      this.id = makeId();
      this.startedAt = nowIso();
      this.endedAt = null;
      this.status = 'ready';
      this.drawn = [];
      this.deck = shuffledBalls();
      this.interval = config.interval;
      this.auto = config.auto;
      this.elapsedMs = 0;
      this.activeSince = null;
      this.timer = emptyTimer(config.interval);
      this.tie = makeTie();
      this.createdAt = this.startedAt;
      this.updatedAt = this.startedAt;
      this.recoveredAt = null;
      this.endReason = null;
    }

    get current() {
      return this.drawn.length ? this.drawn[this.drawn.length - 1] : null;
    }

    get previous() {
      return this.drawn.length > 1 ? this.drawn[this.drawn.length - 2] : null;
    }

    get remaining() {
      return this.deck.length;
    }

    get progress() {
      return Math.round((this.drawn.length / TOTAL_BALLS) * 100);
    }

    begin(clock = Date.now()) {
      if (this.status === 'finished') throw new Error('A partida já foi finalizada.');
      if (!this.activeSince) this.activeSince = clock;
      this.status = 'running';
      this.updatedAt = new Date(clock).toISOString();
    }

    /* Reserva e revela são uma única transação de dados: recarregar nunca perde a bola. */
    drawNext(clock = Date.now()) {
      if (this.status === 'finished') throw new Error('A partida está finalizada. Recupere-a para continuar.');
      if (!this.deck.length) throw new Error('Todas as 75 bolas já foram sorteadas.');
      if (this.status === 'ready') this.begin(clock);
      if (!this.activeSince) this.activeSince = clock;
      this.status = 'drawing';
      this.timer.deadline = null;
      this.timer.remainingMs = this.interval * 1000;
      this.timer.durationMs = this.interval * 1000;
      const number = this.deck.pop();
      if (this.drawn.includes(number)) throw new Error('Integridade violada: bola duplicada bloqueada.');
      this.drawn.push(number);
      this.updatedAt = new Date(clock).toISOString();
      return number;
    }

    completeDraw(clock = Date.now()) {
      if (this.status === 'finished') return;
      if (this.status === 'drawing') {
        if (!this.deck.length) {
          this.finish(clock, 'all-drawn');
        } else {
          this.status = 'running';
          this.schedule(clock, this.interval * 1000);
        }
      }
      this.updatedAt = new Date(clock).toISOString();
    }

    schedule(clock = Date.now(), remainingMs) {
      const duration = this.interval * 1000;
      const remaining = Number.isFinite(remainingMs) ? clamp(remainingMs, 1, 300000) : duration;
      this.timer.durationMs = duration;
      this.timer.remainingMs = remaining;
      this.timer.deadline = this.auto && this.status === 'running' ? clock + remaining : null;
    }

    pause(clock = Date.now()) {
      if (!['running', 'drawing'].includes(this.status)) return false;
      if (this.timer.deadline) {
        this.timer.remainingMs = clamp(this.timer.deadline - clock, 1, 300000);
      } else if (!Number.isFinite(this.timer.remainingMs) || this.timer.remainingMs <= 0) {
        this.timer.remainingMs = this.interval * 1000;
      }
      this.timer.deadline = null;
      this.accumulateElapsed(clock);
      this.status = 'paused';
      this.updatedAt = new Date(clock).toISOString();
      return true;
    }

    continue(clock = Date.now()) {
      if (this.status !== 'paused') return false;
      if (!this.deck.length) return false;
      this.status = 'running';
      this.activeSince = clock;
      this.schedule(clock, this.timer.remainingMs || this.interval * 1000);
      this.updatedAt = new Date(clock).toISOString();
      return true;
    }

    accumulateElapsed(clock) {
      if (this.activeSince) {
        this.elapsedMs += Math.max(0, clock - this.activeSince);
        this.activeSince = null;
      }
    }

    getElapsed(clock = Date.now()) {
      return this.elapsedMs + (this.activeSince && ['running', 'drawing'].includes(this.status) ? Math.max(0, clock - this.activeSince) : 0);
    }

    finish(clock = Date.now(), reason = 'operator') {
      if (this.status === 'finished') return false;
      this.accumulateElapsed(clock);
      this.status = 'finished';
      this.endedAt = new Date(clock).toISOString();
      this.endReason = reason;
      this.timer.deadline = null;
      this.timer.remainingMs = this.interval * 1000;
      this.updatedAt = this.endedAt;
      return true;
    }

    updateTiming(newInterval, auto, clock = Date.now()) {
      const nextInterval = clamp(Math.round(Number(newInterval) || 10), 1, 300);
      const oldDuration = Math.max(1000, Number(this.timer.durationMs) || this.interval * 1000);
      const oldRemaining = this.timer.deadline
        ? clamp(this.timer.deadline - clock, 0, 300000)
        : clamp(Number(this.timer.remainingMs) || oldDuration, 0, 300000);
      const elapsedInCountdown = Math.max(0, oldDuration - oldRemaining);
      const nextDuration = nextInterval * 1000;
      const nextRemaining = clamp(nextDuration - elapsedInCountdown, 1, nextDuration);
      this.interval = nextInterval;
      this.auto = Boolean(auto);
      this.timer.durationMs = nextDuration;
      this.timer.remainingMs = nextRemaining;
      this.timer.deadline = this.auto && this.status === 'running' ? clock + nextRemaining : null;
      this.updatedAt = new Date(clock).toISOString();
    }

    recoverForOpening(clock = Date.now()) {
      // Ao reabrir, nenhuma bola é disparada sem uma ação consciente do operador.
      if (['running', 'drawing'].includes(this.status)) {
        this.pause(clock);
      }
      this.recoveredAt = new Date(clock).toISOString();
      this.updatedAt = this.recoveredAt;
    }
  }

  function validateGame(candidate) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Partida ausente ou inválida.');
    if (candidate.version !== SCHEMA_VERSION) throw new Error('Versão de partida não suportada.');
    if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 80) throw new Error('Identificador de partida inválido.');
    if (!isValidDate(candidate.startedAt)) throw new Error('Data de início inválida.');
    if (!['ready', 'running', 'paused', 'drawing', 'finished'].includes(candidate.status)) throw new Error('Status de partida inválido.');
    if (!Array.isArray(candidate.drawn) || !Array.isArray(candidate.deck)) throw new Error('Listas de bolas inválidas.');
    const all = candidate.drawn.concat(candidate.deck);
    if (candidate.drawn.length > TOTAL_BALLS || all.length !== TOTAL_BALLS) throw new Error('Quantidade incorreta de bolas.');
    if (all.some(number => !Number.isInteger(number) || number < 1 || number > TOTAL_BALLS)) throw new Error('Bola fora do intervalo oficial.');
    if (new Set(all).size !== TOTAL_BALLS) throw new Error('Bolas repetidas ou ausentes no backup.');

    const game = Object.create(BingoGame.prototype);
    game.version = SCHEMA_VERSION;
    game.id = candidate.id;
    game.startedAt = candidate.startedAt;
    game.createdAt = isValidDate(candidate.createdAt) ? candidate.createdAt : candidate.startedAt;
    game.updatedAt = isValidDate(candidate.updatedAt) ? candidate.updatedAt : candidate.startedAt;
    game.endedAt = isValidDate(candidate.endedAt) ? candidate.endedAt : null;
    game.status = candidate.status;
    game.drawn = candidate.drawn.slice();
    game.deck = candidate.deck.slice();
    game.interval = clamp(Math.round(Number(candidate.interval) || 10), 1, 300);
    game.auto = typeof candidate.auto === 'boolean' ? candidate.auto : true;
    game.elapsedMs = clamp(Number(candidate.elapsedMs) || 0, 0, 365 * 24 * 3600000);
    game.activeSince = Number.isFinite(Number(candidate.activeSince)) ? Number(candidate.activeSince) : null;
    game.timer = {
      remainingMs: clamp(Number(candidate.timer && candidate.timer.remainingMs) || game.interval * 1000, 1, 300000),
      durationMs: clamp(Number(candidate.timer && candidate.timer.durationMs) || game.interval * 1000, 1000, 300000),
      deadline: Number.isFinite(Number(candidate.timer && candidate.timer.deadline)) && candidate.timer.deadline !== null ? Number(candidate.timer.deadline) : null
    };
    game.tie = normalizeTie(candidate.tie);
    game.recoveredAt = isValidDate(candidate.recoveredAt) ? candidate.recoveredAt : null;
    game.endReason = typeof candidate.endReason === 'string' ? candidate.endReason.slice(0, 30) : null;
    if (game.status === 'finished' && !game.endedAt) game.endedAt = game.updatedAt;
    return game;
  }

  class BingoStorage {
    constructor(onError) {
      this.onError = typeof onError === 'function' ? onError : function () {};
      this.available = true;
      this.lastSavedAt = null;
    }

    read(key) {
      try {
        const raw = global.localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (error) {
        this.onError(`Não foi possível ler ${key}: ${error.message}`);
        return null;
      }
    }

    write(key, value) {
      try {
        global.localStorage.setItem(key, JSON.stringify(value));
        this.lastSavedAt = nowIso();
        return true;
      } catch (error) {
        this.available = false;
        this.onError(`Falha ao salvar no navegador: ${error.message}`);
        return false;
      }
    }

    readSnapshot(key) {
      const snapshot = this.read(key);
      if (!snapshot) return null;
      try {
        return {
          savedAt: isValidDate(snapshot.savedAt) ? snapshot.savedAt : snapshot.game.updatedAt,
          game: validateGame(snapshot.game)
        };
      } catch (error) {
        this.onError(`Backup ${key} inválido: ${error.message}`);
        return null;
      }
    }

    saveCurrent(game) {
      return this.write(KEYS.current, { savedAt: nowIso(), game: clone(game) });
    }

    saveBackup(game) {
      return this.write(KEYS.backup, { savedAt: nowIso(), game: clone(game) });
    }

    saveFinished(game) {
      return this.write(KEYS.finished, { savedAt: nowIso(), game: clone(game) });
    }

    /* A cópia mais recente é concluída antes de alterar a partida atual. */
    preserveBeforeReplacement(current) {
      if (!current) return true;
      // O objeto em memória pode conter jogadas posteriores ao último save bem-sucedido.
      // Ele tem prioridade sobre um snapshot antigo para nunca preservar uma versão atrasada.
      return this.saveBackup(current);
    }

    loadSettings() {
      return normalizeSettings(this.read(KEYS.settings));
    }

    saveSettings(settings) {
      return this.write(KEYS.settings, normalizeSettings(settings));
    }

    saveTie(tie) {
      return this.write(KEYS.tie, normalizeTie(tie));
    }

    loadTie() {
      return normalizeTie(this.read(KEYS.tie));
    }

    slots() {
      return {
        current: this.readSnapshot(KEYS.current),
        backup: this.readSnapshot(KEYS.backup),
        finished: this.readSnapshot(KEYS.finished)
      };
    }
  }

  class SoundManager {
    constructor(settings) {
      this.context = null;
      this.enabled = settings.sound;
      this.volume = settings.volume / 100;
    }

    configure(settings) {
      this.enabled = settings.sound;
      this.volume = settings.volume / 100;
    }

    ensureContext() {
      if (!this.enabled) return null;
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      if (!this.context) this.context = new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      return this.context;
    }

    tone(frequency, start, duration, gainValue, type = 'sine') {
      const context = this.ensureContext();
      if (!context || this.volume <= 0) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const begins = context.currentTime + start;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, begins);
      gain.gain.setValueAtTime(0.0001, begins);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue * this.volume), begins + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, begins + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(begins);
      oscillator.stop(begins + duration + .02);
    }

    play(name) {
      if (!this.enabled || this.volume <= 0) return;
      const notes = {
        start: [[392, 0, .16, .12], [523.25, .13, .22, .13], [659.25, .27, .3, .1]],
        rolling: [[150, 0, .09, .055, 'triangle'], [210, .12, .08, .04, 'triangle'], [170, .25, .08, .04, 'triangle']],
        reveal: [[523.25, 0, .18, .12], [783.99, .11, .35, .1]],
        pause: [[440, 0, .12, .08], [330, .1, .2, .07]],
        finish: [[392, 0, .18, .1], [329.63, .15, .2, .08], [261.63, .32, .38, .08]],
        tie: [[220, 0, .12, .07, 'triangle'], [330, .14, .12, .07, 'triangle'], [440, .28, .16, .08, 'triangle']],
        win: [[523.25, 0, .16, .1], [659.25, .12, .16, .1], [783.99, .24, .18, .11], [1046.5, .38, .5, .12]]
      };
      (notes[name] || []).forEach(note => this.tone(...note));
    }
  }

  global.Bingo75 = Object.freeze({
    TOTAL_BALLS,
    SCHEMA_VERSION,
    KEYS,
    LETTERS,
    DEFAULT_SETTINGS,
    BingoGame,
    BingoStorage,
    SoundManager,
    letterFor,
    secureRandomInt,
    shuffledBalls,
    normalizeSettings,
    normalizeTie,
    makeTie,
    validateGame,
    clone,
    pad,
    makeId,
    nowIso
  });
})(window);
