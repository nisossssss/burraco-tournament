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

function touchAudit(isCreation = false) {
  const now = new Date().toISOString();

  if (
    isCreation ||
    !tournament.state.audit.createdAt
  ) {
    tournament.state.audit.createdAt = now;
  }

  tournament.state.audit.updatedAt = now;
}


function persistAndBroadcast() {
  touchAudit();

  saveTournamentData(tournament);

  io.emit(
    'tournament:update',
    tournament
  );
}


function buildTeamId() {
  return `team-${Date.now()}-${Math.floor(
    Math.random() * 100000
  )}`;
}


function validateManualGroups(config) {
  const g1 =
    Array.isArray(config.manualGroups?.G1)
      ? config.manualGroups.G1
      : [];

  const g2 =
    Array.isArray(config.manualGroups?.G2)
      ? config.manualGroups.G2
      : [];

  if (
    g1.length !== config.teamsPerGroup ||
    g2.length !== config.teamsPerGroup
  ) {
    throw new Error(
      `I gironi manuali devono contenere ${config.teamsPerGroup} squadre ciascuno.`
    );
  }

  const merged = [
    ...g1,
    ...g2
  ].map(name =>
    String(name || '').trim()
  );

  if (merged.some(name => !name)) {
    throw new Error(
      'Nei gironi manuali ci sono nomi squadra vuoti.'
    );
  }

  const lowered =
    merged.map(name =>
      name.toLowerCase()
    );

  if (
    new Set(lowered).size !==
    merged.length
  ) {
    throw new Error(
      'Nei gironi manuali ci sono squadre duplicate.'
    );
  }

  return {
    G1: g1,
    G2: g2
  };
}


function findManualCodeForTeam(teamName) {
  const codes =
    tournament.config.manualAccessCodes ||
    tournament.config.manualAccesCodes ||
    {};

  const found =
    Object.entries(codes).find(
      ([name]) =>
        name.toLowerCase() ===
        teamName.toLowerCase()
    );

  return found
    ? String(found[1])
    : null;
}


function shuffleArray(items) {
  const arr = [...items];

  for (
    let i = arr.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() * (i + 1)
      );

    [
      arr[i],
      arr[j]
    ] = [
      arr[j],
      arr[i]
    ];
  }

  return arr;
}


// GENERETATORI PARTITE ROUND-ROBIN
function buildRoundRobinMatches(
  groupName,
  teamNames
) {
  const teams =
    [...teamNames];

  if (
    teams.length % 2 !== 0
  ) {
    teams.push('__BYE__');
  }

  const matches = [];

  let rotation =
    [...teams];

  const roundsCount =
    rotation.length - 1;

  const half =
    rotation.length / 2;

  for (
    let round = 1;
    round <= roundsCount;
    round++
  ) {
    for (
      let i = 0;
      i < half;
      i++
    ) {
      const home =
        rotation[i];

      const away =
        rotation[
          rotation.length - 1 - i
        ];

      if (
        home !== '__BYE__' &&
        away !== '__BYE__'
      ) {
        matches.push({
          id:
            `${groupName}-R${round}-M${i + 1}`,

          group:
            groupName,

          round,

          home,
          away,

          status:
            'scheduled',

          played:
            false,

          winner:
            null,

          scoreHome:
            null,

          scoreAway:
            null,

          scoreHomeSubmittedAt:
            null,

          scoreAwaySubmittedAt:
            null,

          managerEditedAt:
            null
        });
      }
    }

    const fixed =
      rotation[0];

    const rest =
      rotation.slice(1);

    rest.unshift(
      rest.pop()
    );

    rotation = [
      fixed,
      ...rest
    ];
  }

  return matches;
}


function parseScore(value) {
  const score =
    Number(value);

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

  if (
    match.scoreHome ===
    match.scoreAway
  ) {
    match.winner = null;

    return;
  }

  match.winner =
    match.scoreHome >
    match.scoreAway
      ? match.home
      : match.away;
}


function findConnectedTeamBySocket(
  socketId
) {
  return (
    tournament.state.connectedTeams.find(
      team =>
        team.socketId === socketId
    ) || null
  );
}


function roundMatches(round) {
  return tournament
    .state
    .groupMatches
    .filter(
      match =>
        match.round === round
    );
}


function isRoundCompleted(round) {
  const matches =
    roundMatches(round);

  return (
    matches.length > 0 &&
    matches.every(
      match => match.played
    )
  );
}

app.get(
  '/api/tournament',
  (_req, res) => {
    res.json(tournament);
  }
);

app.post(
  '/api/tournament/settings',

  (req, res) => {
    const expectedTeams =
      Number(
        req.body.expectedTeams
      );

    if (
      !Number.isInteger(expectedTeams) ||
      expectedTeams < 2
    ) {
      return res
        .status(400)
        .json({
          error:
            'Il numero squadre previsto deve essere un intero >= 2.'
        });
    }

    tournament
      .state
      .expectedTeams =
        expectedTeams;

    persistAndBroadcast();

    return res.json(
      tournament
    );
  }
);

app.post(
  '/api/tournament/group-matches/generate',

  (_req, res) => {
    try {
      const groups =
        validateManualGroups(
          tournament.config
        );

      if (
        tournament
          .state
          .connectedTeams
          .length !==
        tournament
          .state
          .expectedTeams
      ) {
        return res
          .status(400)
          .json({
            error:
              `Devono essere connesse tutte le ${tournament.state.expectedTeams} squadre prima di generare le partite.`
          });
      }

      const connectedNames =
        tournament
          .state
          .connectedTeams
          .map(
            team =>
              team.name.toLowerCase()
          );

      const allGroupTeams = [
        ...groups.G1,
        ...groups.G2
      ];

      const allConnected =
        allGroupTeams.every(
          name =>
            connectedNames.includes(
              String(name)
                .toLowerCase()
            )
        );

      if (!allConnected) {
        return res
          .status(400)
          .json({
            error:
              'Non tutte le squadre dei gironi risultano connesse.'
          });
      }

      const g1Matches =
        buildRoundRobinMatches(
          'G1',
          shuffleArray(
            groups.G1
          )
        );

      const g2Matches =
        buildRoundRobinMatches(
          'G2',
          shuffleArray(
            groups.G2
          )
        );

      tournament.state.groups.G1 =
        groups.G1;

      tournament.state.groups.G2 =
        groups.G2;

      tournament.state.groupMatches = [
        ...g1Matches,
        ...g2Matches
      ];

      tournament.state.activeGroupRound =
        null;

      tournament.state.phase =
        'groups_day_1';

      persistAndBroadcast();

      return res.json(
        tournament
      );

    } catch (error) {
      return res
        .status(400)
        .json({
          error:
            error.message ||
            'Errore nella generazione partite gironi.'
        });
    }
  }
);

app.post(
  '/api/tournament/group-rounds/:round/start',

  (req, res) => {
    const round =
      Number(
        req.params.round
      );

    const matches =
      roundMatches(round);

    if (
      !Number.isInteger(round) ||
      round < 1 ||
      matches.length === 0
    ) {
      return res
        .status(400)
        .json({
          error:
            'Turno non valido.'
        });
    }

    const activeRound =
      tournament
        .state
        .activeGroupRound;

    /*
     * Impedisce di cambiare turno
     * mentre quello precedente
     * non è ancora finito.
     */
    if (
      activeRound &&
      activeRound !== round &&
      !isRoundCompleted(
        activeRound
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            `Prima di avviare il Turno ${round}, completa tutte le partite del Turno ${activeRound}.`
        });
    }

    /*
     * Impedisce di saltare
     * direttamente un turno.
     */
    if (
      round > 1 &&
      !isRoundCompleted(
        round - 1
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            `Il Turno ${round - 1} non è ancora completo.`
        });
    }

    tournament
      .state
      .activeGroupRound =
        round;

    tournament
      .state
      .groupMatches
      .forEach(match => {

        if (match.played) {
          match.status =
            'completed';
        }

        else if (
          match.round === round
        ) {
          match.status =
            'active';
        }

        else {
          match.status =
            'scheduled';
        }
      });

    persistAndBroadcast();

    return res.json(
      tournament
    );
  }
);

app.post(
  '/api/tournament/group-matches/:matchId/score',

  (req, res) => {
    const match =
      tournament
        .state
        .groupMatches
        .find(
          item =>
            item.id ===
            req.params.matchId
        );

    if (!match) {
      return res
        .status(404)
        .json({
          error:
            'Partita non trovata.'
        });
    }

    const scoreHome =
      parseScore(
        req.body.scoreHome
      );

    const scoreAway =
      parseScore(
        req.body.scoreAway
      );

    if (
      scoreHome === null ||
      scoreAway === null
    ) {
      return res
        .status(400)
        .json({
          error:
            'Inserisci due punteggi interi validi.'
        });
    }

    match.scoreHome =
      scoreHome;

    match.scoreAway =
      scoreAway;

    match.scoreHomeSubmittedAt =
      match.scoreHomeSubmittedAt ||
      new Date().toISOString();

    match.scoreAwaySubmittedAt =
      match.scoreAwaySubmittedAt ||
      new Date().toISOString();

    /*
     * Segniamo che il risultato
     * è stato toccato dal manager.
     */
    match.managerEditedAt =
      new Date().toISOString();

    finalizeMatchIfReady(
      match
    );

    persistAndBroadcast();

    return res.json(
      tournament
    );
  }
);

app.post(
  '/api/tournament/reset',

  (_req, res) => {
    tournament.state.phase =
      'waiting-room';

    tournament.state.connectedTeams =
      [];

    tournament.state.registeredTeams =
      [];

    tournament.state.groupMatches =
      [];

    tournament.state.groupStandings = {
      G1: [],
      G2: []
    };

    tournament.state.activeGroupRound =
      null;

    tournament.state.knockoutMatches =
      [];

    const groups =
      validateManualGroups(
        tournament.config
      );

    tournament.state.groups.G1 =
      groups.G1;

    tournament.state.groups.G2 =
      groups.G2;

    touchAudit(true);

    saveTournamentData(
      tournament
    );

    io.emit(
      'tournament:update',
      tournament
    );

    return res.json(
      tournament
    );
  }
);

io.on(
  'connection',

  socket => {

    /*
     * Appena un client si collega,
     * riceve tutto lo stato corrente.
     */
    socket.emit(
      'tournament:update',
      tournament
    );

    socket.on(
      'team:join',

      joinPayload => {

        const alreadyBoundToTeam =
          findConnectedTeamBySocket(
            socket.id
          );

        if (alreadyBoundToTeam) {
          socket.emit(
            'team:join:error',
            `Sei già connesso come ${alreadyBoundToTeam.name}.`
          );

          return;
        }

        const rawName =
          typeof joinPayload ===
          'string'
            ? joinPayload
            : joinPayload?.name;

        const rawCode =
          typeof joinPayload ===
          'string'
            ? ''
            : joinPayload?.code;

        const name =
          String(
            rawName || ''
          ).trim();

        const code =
          String(
            rawCode || ''
          ).trim();

        if (!name) {
          socket.emit(
            'team:join:error',
            'Il nome squadra è obbligatorio.'
          );

          return;
        }

        if (
          tournament.state.phase !==
            'waiting-room' &&
          tournament.state.phase !==
            'groups_day_1'
        ) {
          socket.emit(
            'team:join:error',
            'Le iscrizioni sono chiuse.'
          );

          return;
        }

        const manualTeams = [
          ...(
            tournament
              .config
              .manualGroups
              ?.G1 || []
          ),

          ...(
            tournament
              .config
              .manualGroups
              ?.G2 || []
          )
        ].map(team =>
          String(team || '')
            .trim()
        );

        const allowed =
          manualTeams.some(
            team =>
              team.toLowerCase() ===
              name.toLowerCase()
          );

        if (!allowed) {
          socket.emit(
            'team:join:error',
            'Squadra non presente nei gironi configurati.'
          );

          return;
        }

        const expectedCode =
          findManualCodeForTeam(
            name
          );

        if (!expectedCode) {
          socket.emit(
            'team:join:error',
            'Codice non configurato per questa squadra.'
          );

          return;
        }

        if (
          code !==
          expectedCode
        ) {
          socket.emit(
            'team:join:error',
            'Codice squadra non valido.'
          );

          return;
        }

        /*
         * Non consentiamo due telefoni
         * contemporaneamente come
         * stessa squadra.
         */
        const alreadyJoined =
          tournament
            .state
            .connectedTeams
            .some(
              team =>
                team.name
                  .toLowerCase() ===
                name.toLowerCase()
            );

        if (alreadyJoined) {
          socket.emit(
            'team:join:error',
            'Questa squadra è già connessa da un altro dispositivo.'
          );

          return;
        }

        if (
          tournament
            .state
            .expectedTeams > 0 &&
          tournament
            .state
            .connectedTeams
            .length >=
          tournament
            .state
            .expectedTeams
        ) {
          socket.emit(
            'team:join:error',
            'Numero massimo di squadre raggiunto.'
          );

          return;
        }

        /*
         * Recuperiamo il nome esattamente
         * come configurato nel torneo,
         * preservando maiuscole/minuscole.
         */
        const configuredName =
          manualTeams.find(
            team =>
              team.toLowerCase() ===
              name.toLowerCase()
          ) || name;

        const team = {
          id:
            buildTeamId(),

          name:
            configuredName,

          socketId:
            socket.id,

          connected:
            true
        };

        tournament
          .state
          .connectedTeams
          .push(team);

        if (
          !tournament
            .state
            .registeredTeams
            .includes(
              configuredName
            )
        ) {
          tournament
            .state
            .registeredTeams
            .push(
              configuredName
            );
        }

        persistAndBroadcast();

        socket.emit(
          'team:joined',
          team
        );
      }
    );

    socket.on(
      'team:leave',

      () => {
        const teamIndex =
          tournament
            .state
            .connectedTeams
            .findIndex(
              team =>
                team.socketId ===
                socket.id
            );

        if (
          teamIndex !== -1
        ) {
          tournament
            .state
            .connectedTeams
            .splice(
              teamIndex,
              1
            );

          persistAndBroadcast();
        }

        socket.emit(
          'team:left'
        );
      }
    );

    socket.on(
      'match:score:submit',

      payload => {

        /*
         * Il server identifica la squadra
         * usando il socket.
         *
         * Il telefono NON può dire:
         * "sono Squadra 5".
         */
        const team =
          findConnectedTeamBySocket(
            socket.id
          );

        if (!team) {
          socket.emit(
            'match:score:error',
            'Devi essere connesso come squadra per inserire il punteggio.'
          );

          return;
        }

        const match =
          tournament
            .state
            .groupMatches
            .find(
              item =>
                item.id ===
                payload?.matchId
            );

        if (!match) {
          socket.emit(
            'match:score:error',
            'Partita non trovata.'
          );

          return;
        }

        /*
         * Si può inviare il risultato
         * solamente della partita
         * appartenente al turno attivo.
         */
        if (
          match.round !==
            tournament
              .state
              .activeGroupRound ||

          match.status !==
            'active'
        ) {
          socket.emit(
            'match:score:error',
            'Questa partita non è attiva.'
          );

          return;
        }

        const isHome =
          match.home
            .toLowerCase() ===
          team.name
            .toLowerCase();

        const isAway =
          match.away
            .toLowerCase() ===
          team.name
            .toLowerCase();

        /*
         * Una squadra non può inserire
         * risultati di altre partite.
         */
        if (
          !isHome &&
          !isAway
        ) {
          socket.emit(
            'match:score:error',
            'Questa partita non appartiene alla tua squadra.'
          );

          return;
        }

        const score =
          parseScore(
            payload?.score
          );

        if (
          score === null
        ) {
          socket.emit(
            'match:score:error',
            'Inserisci un punteggio intero valido.'
          );

          return;
        }

        /*
         * Una squadra può inviare
         * il proprio risultato
         * una sola volta.
         *
         * Successivamente interviene
         * il manager.
         */
        if (
          (
            isHome &&
            match.scoreHome !== null
          ) ||
          (
            isAway &&
            match.scoreAway !== null
          )
        ) {
          socket.emit(
            'match:score:error',
            'Hai già inviato il tuo punteggio. Per correggerlo rivolgiti al manager.'
          );

          return;
        }

        const now =
          new Date().toISOString();

        /*
         * La squadra può modificare
         * esclusivamente IL SUO punteggio.
         */
        if (isHome) {
          match.scoreHome =
            score;

          match.scoreHomeSubmittedAt =
            now;
        }

        else {
          match.scoreAway =
            score;

          match.scoreAwaySubmittedAt =
            now;
        }

        /*
         * Se è arrivato anche il risultato
         * dell'altra squadra, chiudiamo
         * automaticamente la partita.
         */
        finalizeMatchIfReady(
          match
        );

        persistAndBroadcast();

        socket.emit(
          'match:score:accepted',
          {
            matchId:
              match.id,

            score
          }
        );
      }
    );

    socket.on(
      'disconnect',

      () => {
        const teamIndex =
          tournament
            .state
            .connectedTeams
            .findIndex(
              team =>
                team.socketId ===
                socket.id
            );

        if (
          teamIndex !== -1
        ) {
          tournament
            .state
            .connectedTeams
            .splice(
              teamIndex,
              1
            );

          persistAndBroadcast();
        }
      }
    );
  }
);

server.listen(
  PORT,
  '0.0.0.0',

  () => {
    console.log(
      `Server in ascolto su http://0.0.0.0:${PORT}`
    );
  }
);