const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const {
  defaultTournament,
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
  if (isCreation || !tournament.state.audit.createdAt) {
    tournament.state.audit.createdAt = now;
  }
  tournament.state.audit.updatedAt = now;
}

function persistAndBroadcast() {
  saveTournamentData(tournament);
  io.emit('tournament:update', tournament);
}

function buildTeamId() {
  return `team-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function validateManualGroups(config) {
  const g1 = Array.isArray(config.manualGroups?.G1) ? config.manualGroups.G1 : [];
  const g2 = Array.isArray(config.manualGroups?.G2) ? config.manualGroups.G2 : [];

  if (g1.length !== config.teamsPerGroup || g2.length !== config.teamsPerGroup) {
    throw new Error('I gironi manuali devono contenere 6 squadre ciascuno.');
  }

  const merged = [...g1, ...g2].map((name) => String(name || '').trim());
  if (merged.some((name) => !name)) {
    throw new Error('Nei gironi manuali ci sono nomi squadra vuoti.');
  }

  const lowered = merged.map((n) => n.toLowerCase());
  const unique = new Set(lowered);
  if (unique.size !== merged.length) {
    throw new Error('Nei gironi manuali ci sono squadre duplicate.');
  }

  return { G1: g1, G2: g2 };
}

function findManualCodeForTeam(teamName) {
  const codes = tournament.config.manualAccessCodes || tournament.config.manualAccesCodes || {};
  const entries = Object.entries(codes);
  const found = entries.find(([name]) => name.toLowerCase() === teamName.toLowerCase());
  return found ? String(found[1]) : null;
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildRoundRobinMatches(groupName, teamNames) {
  const teams = [...teamNames];

  if (teams.length % 2 !== 0) {
    teams.push('__BYE__');
  }

  const rounds = [];
  let rotation = [...teams];
  const roundsCount = rotation.length - 1;
  const half = rotation.length / 2;

  for (let round = 1; round <= roundsCount; round += 1) {
    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[rotation.length - 1 - i];

      if (home !== '__BYE__' && away !== '__BYE__') {
        rounds.push({
          id: `${groupName}-R${round}-M${i + 1}`,
          group: groupName,
          round,
          home,
          away,
          played: false,
          winner: null,
          scoreHome: null,
          scoreAway: null
        });
      }
    }

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation = [fixed, ...rest];
  }

  return rounds;
}

app.get('/api/tournament', (_req, res) => {
  res.json(tournament);
});

app.post('/api/tournament/settings', (req, res) => {
  const expectedTeams = Number(req.body.expectedTeams);

  if (!Number.isInteger(expectedTeams) || expectedTeams < 2) {
    return res.status(400).json({
      error: 'Il numero squadre previsto deve essere un intero >= 2.'
    });
  }

  tournament.state.expectedTeams = expectedTeams;
  touchAudit();
  persistAndBroadcast();

  return res.json(tournament);
});

app.post('/api/tournament/group-matches/generate', (_req, res) => {
  try {
    const groups = validateManualGroups(tournament.config);

    if (tournament.state.connectedTeams.length !== tournament.state.expectedTeams) {
      return res.status(400).json({
        error: `Devono essere connesse tutte le ${tournament.state.expectedTeams} squadre prima di generare le partite.`
      });
    }

    const connectedNames = tournament.state.connectedTeams.map((t) => t.name.toLowerCase());
    const allGroupTeams = [...groups.G1, ...groups.G2];

    const allConnected = allGroupTeams.every((name) =>
      connectedNames.includes(String(name).toLowerCase())
    );
    if (!allConnected) {
      return res.status(400).json({
        error: 'Non tutte le squadre dei gironi risultano connesse.'
      });
    }

    const g1Shuffled = shuffleArray(groups.G1);
    const g2Shuffled = shuffleArray(groups.G2);

    const g1Matches = buildRoundRobinMatches('G1', g1Shuffled);
    const g2Matches = buildRoundRobinMatches('G2', g2Shuffled);

    tournament.state.groups.G1 = groups.G1;
    tournament.state.groups.G2 = groups.G2;
    tournament.state.groupMatches = [...g1Matches, ...g2Matches];
    tournament.state.phase = 'groups_day_1';

    touchAudit();
    persistAndBroadcast();

    return res.json(tournament);
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Errore nella generazione partite gironi.'
    });
  }
});

app.post('/api/tournament/reset', (_req, res) => {
  tournament.state.phase = 'waiting-room';
  tournament.state.connectedTeams = [];
  tournament.state.registeredTeams = [];
  tournament.state.groupMatches = [];
  tournament.state.groupStandings = { G1: [], G2: [] };
  tournament.state.knockoutMatches = [];

  const groups = validateManualGroups(tournament.config);
  tournament.state.groups.G1 = groups.G1;
  tournament.state.groups.G2 = groups.G2;

  touchAudit(true);
  persistAndBroadcast();

  return res.json(tournament);
});

io.on('connection', (socket) => {
  socket.emit('tournament:update', tournament);

  socket.on('team:join', (joinPayload) => {
    const alreadyBoundToTeam = tournament.state.connectedTeams.find(
      (team) => team.socketId === socket.id
    );
    if (alreadyBoundToTeam) {
      socket.emit(
        'team:join:error',
        `Sei gia connesso come ${alreadyBoundToTeam.name}. Disconnettiti prima di rientrare.`
      );
      return;
    }

    const isStringPayload = typeof joinPayload === 'string';
    const rawName = isStringPayload ? joinPayload : joinPayload?.name;
    const rawCode = isStringPayload ? '' : joinPayload?.code;

    const name = String(rawName || '').trim();
    const code = String(rawCode || '').trim();

    if (!name) {
      socket.emit('team:join:error', 'Il nome squadra e obbligatorio.');
      return;
    }

    if (tournament.state.phase !== 'waiting-room' && tournament.state.phase !== 'groups_day_1') {
      socket.emit('team:join:error', 'Le iscrizioni sono chiuse.');
      return;
    }

    const manualTeams = [
      ...(tournament.config.manualGroups?.G1 || []),
      ...(tournament.config.manualGroups?.G2 || [])
    ].map((t) => String(t || '').trim());

    const allowed = manualTeams.some((t) => t.toLowerCase() === name.toLowerCase());
    if (!allowed) {
      socket.emit('team:join:error', 'Squadra non presente nei gironi configurati.');
      return;
    }

    const expectedCode = findManualCodeForTeam(name);
    if (!expectedCode) {
      socket.emit('team:join:error', 'Codice non configurato per questa squadra.');
      return;
    }

    if (code !== expectedCode) {
      socket.emit('team:join:error', 'Codice squadra non valido.');
      return;
    }

    const alreadyJoined = tournament.state.connectedTeams.some(
      (team) => team.name.toLowerCase() === name.toLowerCase()
    );

    if (alreadyJoined) {
      socket.emit('team:join:error', 'Nome squadra gia connesso.');
      return;
    }

    if (
      tournament.state.expectedTeams > 0 &&
      tournament.state.connectedTeams.length >= tournament.state.expectedTeams
    ) {
      socket.emit('team:join:error', 'Numero massimo di squadre raggiunto.');
      return;
    }

    const team = {
      id: buildTeamId(),
      name,
      socketId: socket.id,
      connected: true
    };

    tournament.state.connectedTeams.push(team);

    if (!tournament.state.registeredTeams.includes(name)) {
      tournament.state.registeredTeams.push(name);
    }

    touchAudit();
    persistAndBroadcast();

    socket.emit('team:joined', team);
  });

  socket.on('disconnect', () => {
    const teamIndex = tournament.state.connectedTeams.findIndex(
      (team) => team.socketId === socket.id
    );

    if (teamIndex !== -1) {
      tournament.state.connectedTeams.splice(teamIndex, 1);
      touchAudit();
      persistAndBroadcast();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server in ascolto su http://0.0.0.0:${PORT}`);
});