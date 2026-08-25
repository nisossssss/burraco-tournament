const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const {
  loadTournamentData,
  saveTournamentData
} = require('./src/server/store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.json());

let tournament = loadTournamentData();

/* =========================================================
   AUDIT / PERSISTENZA
========================================================= */

function touchAudit(isCreation = false) {
  const now = new Date().toISOString();

  if (isCreation || !tournament.state.audit.createdAt) {
    tournament.state.audit.createdAt = now;
  }

  tournament.state.audit.updatedAt = now;
}

function persistAndBroadcast() {
  touchAudit();
  saveTournamentData(tournament);
  io.emit('tournament:update', tournament);
}

/* =========================================================
   SQUADRE / CONFIGURAZIONE
========================================================= */

function buildTeamId() {
  return `team-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getConfiguredTeams(config) {
  const g1 = Array.isArray(config.manualGroups?.G1)
    ? config.manualGroups.G1
    : [];

  const g2 = Array.isArray(config.manualGroups?.G2)
    ? config.manualGroups.G2
    : [];

  if (
    g1.length !== config.teamsPerGroup ||
    g2.length !== config.teamsPerGroup
  ) {
    throw new Error(
      `La configurazione deve contenere ${config.teamsPerGroup} squadre per lista.`
    );
  }

  const teams = [...g1, ...g2].map((name) =>
    String(name || '').trim()
  );

  if (teams.some((name) => !name)) {
    throw new Error(
      'Ci sono nomi squadra vuoti nella configurazione.'
    );
  }

  const normalized = teams.map((name) => name.toLowerCase());

  if (new Set(normalized).size !== teams.length) {
    throw new Error(
      'Ci sono squadre duplicate nella configurazione.'
    );
  }

  if (
    Number.isInteger(config.teamsCount) &&
    teams.length !== config.teamsCount
  ) {
    throw new Error(
      `Sono configurate ${teams.length} squadre ma il torneo ne prevede ${config.teamsCount}.`
    );
  }

  return teams;
}

function findManualCodeForTeam(teamName) {
  const codes =
    tournament.config.manualAccessCodes ||
    tournament.config.manualAccesCodes ||
    {};

  const found = Object.entries(codes).find(
    ([name]) => name.toLowerCase() === teamName.toLowerCase()
  );

  return found ? String(found[1]) : null;
}

function findConnectedTeamBySocket(socketId) {
  return (
    tournament.state.connectedTeams.find(
      (team) => team.socketId === socketId
    ) || null
  );
}

/* =========================================================
   SORTEGGIO GIRONI
========================================================= */

function shuffleArray(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function drawGroups(teamNames) {
  const teamsPerGroup = tournament.config.teamsPerGroup;
  const expectedTotal = teamsPerGroup * 2;

  if (teamNames.length !== expectedTotal) {
    throw new Error(
      `Per il sorteggio servono esattamente ${expectedTotal} squadre.`
    );
  }

  const shuffled = shuffleArray(teamNames);

  return {
    G1: shuffled.slice(0, teamsPerGroup),
    G2: shuffled.slice(teamsPerGroup, teamsPerGroup * 2)
  };
}

/* =========================================================
   ROUND ROBIN
========================================================= */

function buildRoundRobinMatches(groupName, teamNames) {
  const teams = [...teamNames];

  if (teams.length % 2 !== 0) {
    teams.push('__BYE__');
  }

  const matches = [];
  let rotation = [...teams];
  const roundsCount = rotation.length - 1;
  const half = rotation.length / 2;

  for (let round = 1; round <= roundsCount; round += 1) {
    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[rotation.length - 1 - i];

      if (home !== '__BYE__' && away !== '__BYE__') {
        matches.push({
          id: `${groupName}-R${round}-M${i + 1}`,
          group: groupName,
          round,
          home,
          away,

          status: 'scheduled',
          played: false,
          winner: null,

          scoreHome: null,
          scoreAway: null,
          scoreHomeSubmittedAt: null,
          scoreAwaySubmittedAt: null,
          managerEditedAt: null,
          startedAt: null,

          /*
           * Incrementato quando il manager annulla
           * una partita. Serve ai telefoni per non
           * riutilizzare le vecchie mani locali.
           */
          resetVersion: 0,

          /*
           * Stato condiviso di fine partita.
           * NON contiene le singole mani.
           */
          finishTriggered: false,
          finishHandCount: null,
          finishTriggeredBy: null,
          finishTriggeredAt: null
        });
      }
    }

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation = [fixed, ...rest];
  }

  return matches;
}

/* =========================================================
   PUNTEGGI
========================================================= */

function parseScore(value) {
  const score = Number(value);

  if (
    !Number.isInteger(score) ||
    score < -100000 ||
    score > 100000
  ) {
    return null;
  }

  return score;
}

function finalizeMatchIfReady(match) {
  if (
    match.scoreHome === null ||
    match.scoreAway === null
  ) {
    return;
  }

  match.played = true;
  match.status = 'completed';

  match.winner =
    match.scoreHome === match.scoreAway
      ? null
      : match.scoreHome > match.scoreAway
        ? match.home
        : match.away;
}


/* =========================================================
   CLASSIFICA UFFICIALE / QUALIFICAZIONE
========================================================= */

function getAllMatches() {
  return [
    ...(Array.isArray(tournament.state.groupMatches)
      ? tournament.state.groupMatches
      : []),

    ...(Array.isArray(tournament.state.knockoutMatches)
      ? tournament.state.knockoutMatches
      : [])
  ];
}

function findMatchById(matchId) {
  return (
    getAllMatches().find(
      (match) => match.id === matchId
    ) ||
    null
  );
}

function areAllGroupMatchesCompleted() {
  const matches =
    tournament.state.groupMatches || [];

  return (
    matches.length > 0 &&
    matches.every(
      (match) =>
        match.played &&
        match.status === 'completed'
    )
  );
}

function buildBaseGroupStats(group) {
  const teams =
    tournament.state.groups?.[group] ||
    [];

  const pointsConfig =
    tournament.config.pointsSystem || {
      win: 1,
      loss: 0
    };

  const stats = {};

  teams.forEach((team) => {
    stats[team] = {
      name: team,
      points: 0,
      difference: 0,
      played: 0,
      wins: 0,
      losses: 0
    };
  });

  tournament.state.groupMatches
    .filter(
      (match) =>
        match.group === group &&
        match.played
    )
    .forEach((match) => {
      const home = stats[match.home];
      const away = stats[match.away];

      if (!home || !away) {
        return;
      }

      home.played += 1;
      away.played += 1;

      home.difference +=
        match.scoreHome -
        match.scoreAway;

      away.difference +=
        match.scoreAway -
        match.scoreHome;

      if (match.winner === match.home) {
        home.wins += 1;
        away.losses += 1;

        home.points += pointsConfig.win;
        away.points += pointsConfig.loss;
      }

      else if (match.winner === match.away) {
        away.wins += 1;
        home.losses += 1;

        away.points += pointsConfig.win;
        home.points += pointsConfig.loss;
      }
    });

  return stats;
}

function buildHeadToHeadPoints(group, tiedTeams) {
  const teamSet = new Set(tiedTeams);

  const pointsConfig =
    tournament.config.pointsSystem || {
      win: 1,
      loss: 0
    };

  const miniPoints = {};

  tiedTeams.forEach((team) => {
    miniPoints[team] = 0;
  });

  tournament.state.groupMatches
    .filter(
      (match) =>
        match.group === group &&
        match.played &&
        teamSet.has(match.home) &&
        teamSet.has(match.away)
    )
    .forEach((match) => {
      if (match.winner === match.home) {
        miniPoints[match.home] += pointsConfig.win;
        miniPoints[match.away] += pointsConfig.loss;
      }

      else if (match.winner === match.away) {
        miniPoints[match.away] += pointsConfig.win;
        miniPoints[match.home] += pointsConfig.loss;
      }
    });

  return miniPoints;
}

function splitByValue(rows, getter, descending = true) {
  const ordered = [...rows].sort((a, b) => {
    const av = getter(a);
    const bv = getter(b);

    return descending
      ? bv - av
      : av - bv;
  });

  const groups = [];

  ordered.forEach((row) => {
    const value = getter(row);
    const last = groups[groups.length - 1];

    if (!last || last.value !== value) {
      groups.push({
        value,
        rows: [row]
      });
    }

    else {
      last.rows.push(row);
    }
  });

  return groups;
}

function rankGroupOfficial(group) {
  const stats = buildBaseGroupStats(group);

  /*
   * Criteri:
   * 1. punti
   * 2. scontro diretto / mini-classifica
   * 3. differenza punti generale
   * 4. sorteggio
   */
  const byPoints = splitByValue(
    Object.values(stats),
    (row) => row.points
  );

  const finalRows = [];

  byPoints.forEach((pointsBucket) => {
    if (pointsBucket.rows.length === 1) {
      finalRows.push(pointsBucket.rows[0]);
      return;
    }

    const names = pointsBucket.rows.map(
      (row) => row.name
    );

    const headToHead = buildHeadToHeadPoints(
      group,
      names
    );

    const rowsWithH2H = pointsBucket.rows.map(
      (row) => ({
        ...row,
        headToHeadPoints:
          headToHead[row.name] || 0
      })
    );

    const byH2H = splitByValue(
      rowsWithH2H,
      (row) => row.headToHeadPoints
    );

    byH2H.forEach((h2hBucket) => {
      if (h2hBucket.rows.length === 1) {
        finalRows.push(h2hBucket.rows[0]);
        return;
      }

      const byDifference = splitByValue(
        h2hBucket.rows,
        (row) => row.difference
      );

      byDifference.forEach((differenceBucket) => {
        if (differenceBucket.rows.length === 1) {
          finalRows.push(differenceBucket.rows[0]);
          return;
        }

        /*
         * Il sorteggio viene effettuato una volta,
         * poi il risultato viene salvato nel JSON
         * dentro groupStandings.
         */
        const drawn = differenceBucket.rows
          .map((row) => ({
            ...row,
            drawLot: Math.random(),
            decidedBy: 'draw_lots'
          }))
          .sort(
            (a, b) => b.drawLot - a.drawLot
          );

        finalRows.push(...drawn);
      });
    });
  });

  return finalRows.map((row, index) => ({
    ...row,
    position: index + 1,
    qualified:
      index <
      Number(
        tournament.config.qualifiedPerGroup || 4
      )
  }));
}

function createKnockoutMatch({
  id,
  slot,
  home,
  away,
  sourceHome,
  sourceAway
}) {
  return {
    id,
    slot,
    stage: 'quarter_final',

    home,
    away,

    sourceHome,
    sourceAway,

    status: 'scheduled',
    played: false,
    winner: null,

    scoreHome: null,
    scoreAway: null,
    scoreHomeSubmittedAt: null,
    scoreAwaySubmittedAt: null,
    managerEditedAt: null,
    startedAt: null,

    resetVersion: 0,

    finishTriggered: false,
    finishHandCount: null,
    finishTriggeredBy: null,
    finishTriggeredAt: null
  };
}

function buildQuarterFinals(standings) {
  const g1 = standings.G1;
  const g2 = standings.G2;

  return [
    createKnockoutMatch({
      id: 'QF1',
      slot: 'QF1',
      home: g1[0].name,
      away: g2[3].name,
      sourceHome: 'G1_1',
      sourceAway: 'G2_4'
    }),

    createKnockoutMatch({
      id: 'QF2',
      slot: 'QF2',
      home: g1[1].name,
      away: g2[2].name,
      sourceHome: 'G1_2',
      sourceAway: 'G2_3'
    }),

    createKnockoutMatch({
      id: 'QF3',
      slot: 'QF3',
      home: g2[0].name,
      away: g1[3].name,
      sourceHome: 'G2_1',
      sourceAway: 'G1_4'
    }),

    createKnockoutMatch({
      id: 'QF4',
      slot: 'QF4',
      home: g2[1].name,
      away: g1[2].name,
      sourceHome: 'G2_2',
      sourceAway: 'G1_3'
    })
  ];
}

function knockoutHasStarted() {
  return (
    tournament.state.knockoutMatches || []
  ).some(
    (match) =>
      match.status === 'active' ||
      match.played ||
      Boolean(match.startedAt) ||
      match.scoreHome !== null ||
      match.scoreAway !== null
  );
}

function finalizeGroupsAndCreateQuarterFinals({
  forceRebuild = false
} = {}) {
  if (!areAllGroupMatchesCompleted()) {
    return false;
  }

  if (
    tournament.state.knockoutMatches.length > 0 &&
    !forceRebuild
  ) {
    return false;
  }

  if (forceRebuild && knockoutHasStarted()) {
    throw new Error(
      'I quarti sono già iniziati: la classifica dei gironi non può più modificare il tabellone.'
    );
  }

  const standings = {
    G1: rankGroupOfficial('G1'),
    G2: rankGroupOfficial('G2')
  };

  tournament.state.groupStandings = standings;
  tournament.state.knockoutMatches =
    buildQuarterFinals(standings);

  tournament.state.phase = 'quarter_finals';

  return true;
}

function targetScoreForMatch(match) {
  if (match?.stage === 'quarter_final') {
    return (
      Number(
        tournament.config.quarterFinalTargetScore
      ) ||
      Number(
        tournament.config.groupTargetScore
      ) ||
      1005
    );
  }

  return (
    Number(
      tournament.config.groupTargetScore
    ) ||
    1005
  );
}

/*
 * Compatibilità con tornei già conclusi con
 * una versione precedente: al riavvio creiamo
 * automaticamente i quarti se necessario.
 */
if (
  areAllGroupMatchesCompleted() &&
  tournament.state.knockoutMatches.length === 0
) {
  finalizeGroupsAndCreateQuarterFinals();
  saveTournamentData(tournament);
}

/* =========================================================
   API
========================================================= */

app.get('/api/tournament', (_req, res) => {
  res.json(tournament);
});

app.post('/api/tournament/settings', (req, res) => {
  const expectedTeams = Number(req.body.expectedTeams);

  if (
    !Number.isInteger(expectedTeams) ||
    expectedTeams < 2
  ) {
    return res.status(400).json({
      error:
        'Il numero squadre previsto deve essere un intero >= 2.'
    });
  }

  tournament.state.expectedTeams = expectedTeams;
  persistAndBroadcast();

  return res.json(tournament);
});

/* =========================================================
   GENERAZIONE / SORTEGGIO GIRONI
========================================================= */

app.post('/api/tournament/group-matches/generate', (_req, res) => {
  try {
    if (tournament.state.groupMatches.length > 0) {
      return res.status(400).json({
        error:
          'Il calendario è già stato generato. Fai prima Reset torneo per effettuare un nuovo sorteggio.'
      });
    }

    const configuredTeams = getConfiguredTeams(
      tournament.config
    );

    if (
      tournament.state.connectedTeams.length !==
      configuredTeams.length
    ) {
      return res.status(400).json({
        error:
          `Devono essere connesse tutte le ${configuredTeams.length} squadre prima del sorteggio.`
      });
    }

    const connectedNames =
      tournament.state.connectedTeams.map(
        (team) => team.name.toLowerCase()
      );

    const allConnected = configuredTeams.every(
      (name) =>
        connectedNames.includes(name.toLowerCase())
    );

    if (!allConnected) {
      return res.status(400).json({
        error:
          'Non tutte le squadre configurate risultano connesse.'
      });
    }

    /*
     * Tutte le 12 squadre vengono mischiate insieme
     * e solo dopo divise 6 + 6.
     */
    const groups = drawGroups(configuredTeams);

    const g1Matches = buildRoundRobinMatches(
      'G1',
      groups.G1
    );

    const g2Matches = buildRoundRobinMatches(
      'G2',
      groups.G2
    );

    tournament.state.groups = {
      G1: [...groups.G1],
      G2: [...groups.G2]
    };

    tournament.state.groupMatches = [
      ...g1Matches,
      ...g2Matches
    ];

    tournament.state.groupStandings = {
      G1: [],
      G2: []
    };

    tournament.state.knockoutMatches = [];

    tournament.state.phase =
      'groups_day_1';

    persistAndBroadcast();

    return res.json(tournament);
  }

  catch (error) {
    return res.status(400).json({
      error:
        error.message ||
        'Errore nella generazione dei gironi.'
    });
  }
});

/* =========================================================
   AVVIO SINGOLA PARTITA
========================================================= */

function findActiveMatchForTeam(
  teamName,
  excludeMatchId = null
) {
  const normalizedTeam =
    String(teamName || '')
      .toLowerCase();

  return (
    getAllMatches().find(
      (match) =>
        match.id !== excludeMatchId &&
        !match.played &&
        match.status === 'active' &&
        (
          String(match.home || '')
            .toLowerCase() === normalizedTeam ||
          String(match.away || '')
            .toLowerCase() === normalizedTeam
        )
    ) ||
    null
  );
}

app.post(
  [
    '/api/tournament/matches/:matchId/start',
    '/api/tournament/group-matches/:matchId/start'
  ],
  (req, res) => {
    const match =
      findMatchById(
        req.params.matchId
      );

    if (!match) {
      return res.status(404).json({
        error:
          'Partita non trovata.'
      });
    }

    if (
      match.played ||
      match.status === 'completed'
    ) {
      return res.status(400).json({
        error:
          'Questa partita è già stata completata.'
      });
    }

    if (match.status === 'active') {
      return res.status(400).json({
        error:
          'Questa partita è già in corso.'
      });
    }

    const homeConflict =
      findActiveMatchForTeam(
        match.home,
        match.id
      );

    if (homeConflict) {
      return res.status(409).json({
        error:
          `${match.home} sta già giocando contro ${
            homeConflict.home === match.home
              ? homeConflict.away
              : homeConflict.home
          }.`
      });
    }

    const awayConflict =
      findActiveMatchForTeam(
        match.away,
        match.id
      );

    if (awayConflict) {
      return res.status(409).json({
        error:
          `${match.away} sta già giocando contro ${
            awayConflict.home === match.away
              ? awayConflict.away
              : awayConflict.home
          }.`
      });
    }

    match.status =
      'active';

    match.startedAt =
      new Date().toISOString();

    persistAndBroadcast();

    return res.json(
      tournament
    );
  }
);

/* =========================================================
   ANNULLA / RESETTA SINGOLA PARTITA
========================================================= */

app.post(
  [
    '/api/tournament/matches/:matchId/cancel',
    '/api/tournament/group-matches/:matchId/cancel'
  ],
  (req, res) => {
    const match =
      findMatchById(
        req.params.matchId
      );

    if (!match) {
      return res.status(404).json({
        error:
          'Partita non trovata.'
      });
    }

    if (
      match.played ||
      match.status === 'completed'
    ) {
      return res.status(400).json({
        error:
          'Una partita già completata non può essere annullata. Usa la correzione risultato se necessario.'
      });
    }

    if (match.status !== 'active') {
      return res.status(400).json({
        error:
          'Puoi annullare solo una partita attualmente in corso.'
      });
    }

    /*
     * Reset completo della singola partita.
     * Eventuali punteggi già inviati vengono rimossi.
     */
    match.status =
      'scheduled';

    match.played =
      false;

    match.winner =
      null;

    match.scoreHome =
      null;

    match.scoreAway =
      null;

    match.scoreHomeSubmittedAt =
      null;

    match.scoreAwaySubmittedAt =
      null;

    match.managerEditedAt =
      null;

    match.startedAt =
      null;

    match.finishTriggered =
      false;

    match.finishHandCount =
      null;

    match.finishTriggeredBy =
      null;

    match.finishTriggeredAt =
      null;

    match.resetVersion =
      Number.isInteger(
        match.resetVersion
      )
        ? match.resetVersion + 1
        : 1;

    persistAndBroadcast();

    return res.json(
      tournament
    );
  }
);

/* =========================================================
   MODIFICA RISULTATO MANAGER
========================================================= */

app.post(
  [
    '/api/tournament/matches/:matchId/score',
    '/api/tournament/group-matches/:matchId/score'
  ],
  (req, res) => {
  const match =
    findMatchById(
      req.params.matchId
    );

  if (!match) {
    return res.status(404).json({
      error: 'Partita non trovata.'
    });
  }

  if (
    match.stage !== 'quarter_final' &&
    tournament.state.phase === 'quarter_finals' &&
    knockoutHasStarted()
  ) {
    return res.status(409).json({
      error:
        'I quarti sono già iniziati. I risultati dei gironi non possono più essere modificati.'
    });
  }

  const scoreHome = parseScore(req.body.scoreHome);
  const scoreAway = parseScore(req.body.scoreAway);

  if (
    scoreHome === null ||
    scoreAway === null
  ) {
    return res.status(400).json({
      error:
        'Inserisci due punteggi interi validi.'
    });
  }

  match.scoreHome = scoreHome;
  match.scoreAway = scoreAway;

  match.scoreHomeSubmittedAt =
    match.scoreHomeSubmittedAt ||
    new Date().toISOString();

  match.scoreAwaySubmittedAt =
    match.scoreAwaySubmittedAt ||
    new Date().toISOString();

  match.managerEditedAt =
    new Date().toISOString();

  /*
   * Se il manager completa manualmente una partita,
   * consideriamo conclusa anche la fase di conteggio.
   */
  if (!match.finishTriggered) {
    match.finishTriggered = true;
    match.finishHandCount = null;
    match.finishTriggeredBy = 'manager';
    match.finishTriggeredAt = new Date().toISOString();
  }

  finalizeMatchIfReady(match);

  if (match.stage !== 'quarter_final') {
    finalizeGroupsAndCreateQuarterFinals({
      forceRebuild:
        tournament.state.knockoutMatches.length > 0
    });
  }

  persistAndBroadcast();

  return res.json(tournament);
});

/* =========================================================
   RESET
========================================================= */

app.post('/api/tournament/reset', (_req, res) => {
  tournament.state.phase = 'waiting-room';

  /*
   * Manteniamo i telefoni attualmente collegati.
   * Reset = nuovo torneo/sorteggio, non logout.
   */
  tournament.state.registeredTeams =
    tournament.state.connectedTeams.map(
      (team) => team.name
    );

  tournament.state.groups = {
    G1: [],
    G2: []
  };

  tournament.state.groupMatches = [];

  tournament.state.groupStandings = {
    G1: [],
    G2: []
  };

  tournament.state.knockoutMatches = [];

  /*
   * Nuovo ID temporale del torneo.
   * Serve anche a separare il localStorage delle mani.
   */
  touchAudit(true);

  saveTournamentData(tournament);
  io.emit('tournament:update', tournament);

  return res.json(tournament);
});

/* =========================================================
   SOCKET.IO
========================================================= */

io.on('connection', (socket) => {
  socket.emit('tournament:update', tournament);

  /* =====================================================
     LOGIN SQUADRA
  ====================================================== */

  socket.on('team:join', (joinPayload) => {
    const alreadyBound =
      findConnectedTeamBySocket(socket.id);

    if (alreadyBound) {
      socket.emit(
        'team:join:error',
        `Sei già connesso come ${alreadyBound.name}.`
      );
      return;
    }

    const rawName =
      typeof joinPayload === 'string'
        ? joinPayload
        : joinPayload?.name;

    const rawCode =
      typeof joinPayload === 'string'
        ? ''
        : joinPayload?.code;

    const name = String(rawName || '').trim();
    const code = String(rawCode || '').trim();

    if (!name) {
      socket.emit(
        'team:join:error',
        'Il nome squadra è obbligatorio.'
      );
      return;
    }

    if (
      tournament.state.phase !== 'waiting-room' &&
      tournament.state.phase !== 'groups_day_1' &&
      tournament.state.phase !== 'quarter_finals'
    ) {
      socket.emit(
        'team:join:error',
        'Le iscrizioni sono chiuse.'
      );
      return;
    }

    let configuredTeams;

    try {
      configuredTeams = getConfiguredTeams(
        tournament.config
      );
    }

    catch (error) {
      socket.emit(
        'team:join:error',
        error.message
      );
      return;
    }

    const configuredName = configuredTeams.find(
      (team) =>
        team.toLowerCase() === name.toLowerCase()
    );

    if (!configuredName) {
      socket.emit(
        'team:join:error',
        'Squadra non presente nella configurazione del torneo.'
      );
      return;
    }

    const expectedCode = findManualCodeForTeam(
      configuredName
    );

    if (!expectedCode) {
      socket.emit(
        'team:join:error',
        'Codice non configurato per questa squadra.'
      );
      return;
    }

    if (code !== expectedCode) {
      socket.emit(
        'team:join:error',
        'Codice squadra non valido.'
      );
      return;
    }

    const alreadyJoined =
      tournament.state.connectedTeams.some(
        (team) =>
          team.name.toLowerCase() ===
          configuredName.toLowerCase()
      );

    if (alreadyJoined) {
      socket.emit(
        'team:join:error',
        'Questa squadra è già connessa da un altro dispositivo.'
      );
      return;
    }

    if (
      tournament.state.expectedTeams > 0 &&
      tournament.state.connectedTeams.length >=
        tournament.state.expectedTeams
    ) {
      socket.emit(
        'team:join:error',
        'Numero massimo di squadre raggiunto.'
      );
      return;
    }

    const team = {
      id: buildTeamId(),
      name: configuredName,
      socketId: socket.id,
      connected: true
    };

    tournament.state.connectedTeams.push(team);

    if (
      !tournament.state.registeredTeams.includes(
        configuredName
      )
    ) {
      tournament.state.registeredTeams.push(
        configuredName
      );
    }

    persistAndBroadcast();
    socket.emit('team:joined', team);
  });

  /* =====================================================
     LOGOUT
  ====================================================== */

  socket.on('team:leave', () => {
    const teamIndex =
      tournament.state.connectedTeams.findIndex(
        (team) => team.socketId === socket.id
      );

    if (teamIndex !== -1) {
      tournament.state.connectedTeams.splice(
        teamIndex,
        1
      );

      persistAndBroadcast();
    }

    socket.emit('team:left');
  });

  /* =====================================================
     UNA SQUADRA HA RAGGIUNTO L'OBIETTIVO
  ====================================================== */

  socket.on('match:finish:trigger', (payload) => {
    const team =
      findConnectedTeamBySocket(socket.id);

    if (!team) {
      return;
    }

    const match =
      findMatchById(
        payload?.matchId
      );

    if (!match) {
      return;
    }

    if (
      match.status !== 'active' ||
      match.played
    ) {
      return;
    }

    const isHome =
      match.home.toLowerCase() ===
      team.name.toLowerCase();

    const isAway =
      match.away.toLowerCase() ===
      team.name.toLowerCase();

    if (!isHome && !isAway) {
      return;
    }

    const handCount = Number(payload?.handCount);
    const reportedScore = parseScore(payload?.score);
    const target =
      targetScoreForMatch(match);

    if (
      !Number.isInteger(handCount) ||
      handCount < 1
    ) {
      return;
    }

    /*
     * Il punteggio viene usato solo per verificare
     * che il trigger sia legittimo. NON viene salvato
     * come risultato ufficiale in questo momento.
     */
    if (
      reportedScore === null ||
      reportedScore < target
    ) {
      return;
    }

    /*
     * Il primo trigger valido fissa la mano finale.
     * Se entrambi superano il target nella stessa mano,
     * il secondo evento viene semplicemente ignorato.
     */
    if (match.finishTriggered) {
      return;
    }

    match.finishTriggered = true;
    match.finishHandCount = handCount;
    match.finishTriggeredBy = team.name;
    match.finishTriggeredAt =
      new Date().toISOString();

    persistAndBroadcast();
  });

  /* =====================================================
     ANNULLAMENTO TRIGGER DOPO CORREZIONE LOCALE
  ====================================================== */

  socket.on('match:finish:cancel', (payload) => {
    const team =
      findConnectedTeamBySocket(socket.id);

    if (!team) {
      return;
    }

    const match =
      findMatchById(
        payload?.matchId
      );

    if (!match) {
      return;
    }

    if (
      !match.finishTriggered ||
      String(match.finishTriggeredBy || '')
        .toLowerCase() !==
        team.name.toLowerCase()
    ) {
      return;
    }

    /*
     * Dopo il primo risultato ufficiale non si torna indietro.
     * Eventuali correzioni vengono gestite dal manager.
     */
    if (
      match.scoreHome !== null ||
      match.scoreAway !== null
    ) {
      return;
    }

    match.finishTriggered = false;
    match.finishHandCount = null;
    match.finishTriggeredBy = null;
    match.finishTriggeredAt = null;

    persistAndBroadcast();
  });

  /* =====================================================
     INVIO RISULTATO FINALE
  ====================================================== */

  socket.on('match:score:submit', (payload) => {
    const team =
      findConnectedTeamBySocket(socket.id);

    if (!team) {
      socket.emit(
        'match:score:error',
        'Devi essere connesso come squadra per inserire il punteggio.'
      );
      return;
    }

    const match =
      findMatchById(
        payload?.matchId
      );

    if (!match) {
      socket.emit(
        'match:score:error',
        'Partita non trovata.'
      );
      return;
    }

    if (
      match.status !== 'active' ||
      match.played
    ) {
      socket.emit(
        'match:score:error',
        'Questa partita non è attiva.'
      );
      return;
    }

    const isHome =
      match.home.toLowerCase() ===
      team.name.toLowerCase();

    const isAway =
      match.away.toLowerCase() ===
      team.name.toLowerCase();

    if (!isHome && !isAway) {
      socket.emit(
        'match:score:error',
        'Questa partita non appartiene alla tua squadra.'
      );
      return;
    }

    const score = parseScore(payload?.score);

    if (score === null) {
      socket.emit(
        'match:score:error',
        'Inserisci un punteggio intero valido.'
      );
      return;
    }

    if (
      (isHome && match.scoreHome !== null) ||
      (isAway && match.scoreAway !== null)
    ) {
      socket.emit(
        'match:score:error',
        'Hai già inviato il tuo punteggio. Per correggerlo rivolgiti al manager.'
      );
      return;
    }

    const target =
      targetScoreForMatch(match);

    /*
     * Se la partita non è ancora stata dichiarata conclusa,
     * solo una squadra >= target può essere la prima a inviare.
     */
    if (
      !match.finishTriggered &&
      score < target
    ) {
      socket.emit(
        'match:score:error',
        `La partita non è ancora conclusa: l'obiettivo è ${target} punti.`
      );
      return;
    }

    /*
     * Se il client usa il contatore mani ed è sotto target,
     * controlliamo che abbia davvero registrato la stessa
     * mano finale dell'avversario.
     *
     * Non salviamo handCount: viene solo validato.
     */
    if (
      score < target &&
      match.finishTriggered &&
      Number.isInteger(match.finishHandCount) &&
      payload?.handCount !== null &&
      payload?.handCount !== undefined
    ) {
      const submittedHandCount = Number(
        payload.handCount
      );

      if (
        !Number.isInteger(submittedHandCount) ||
        submittedHandCount !== match.finishHandCount
      ) {
        socket.emit(
          'match:score:error',
          `La partita è terminata alla mano ${match.finishHandCount}. Devi aver registrato lo stesso numero di mani.`
        );
        return;
      }
    }

    const now = new Date().toISOString();

    if (isHome) {
      match.scoreHome = score;
      match.scoreHomeSubmittedAt = now;
    }

    else {
      match.scoreAway = score;
      match.scoreAwaySubmittedAt = now;
    }

    /*
     * Fallback per la modalità manuale: se il primo invio
     * è >= target e non esiste ancora un trigger, dichiariamo
     * comunque la partita conclusa. Non conosciamo il numero
     * di mani in questo caso.
     */
    if (
      !match.finishTriggered &&
      score >= target
    ) {
      match.finishTriggered = true;
      match.finishHandCount = null;
      match.finishTriggeredBy = team.name;
      match.finishTriggeredAt = now;
    }

    finalizeMatchIfReady(match);

    if (match.stage !== 'quarter_final') {
      finalizeGroupsAndCreateQuarterFinals();
    }

    persistAndBroadcast();

    socket.emit(
      'match:score:accepted',
      {
        matchId: match.id,
        score
      }
    );
  });

  /* =====================================================
     DISCONNECT
  ====================================================== */

  socket.on('disconnect', () => {
    const teamIndex =
      tournament.state.connectedTeams.findIndex(
        (team) => team.socketId === socket.id
      );

    if (teamIndex !== -1) {
      tournament.state.connectedTeams.splice(
        teamIndex,
        1
      );

      persistAndBroadcast();
    }
  });
});

/* =========================================================
   SERVER
========================================================= */

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Server in ascolto su http://0.0.0.0:${PORT}`
  );
});
