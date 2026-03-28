import { useState, useEffect } from 'react';
import { GameGraph } from './utils/graph';
import type { NodeId } from './utils/graph';
import { generateRandomLevel, type LevelDef } from './utils/levels';
import { Play, MapPin, Heart, Star, AlertCircle, Clock, Route, BookOpen, Navigation, ArrowLeft, Zap, Volume2, VolumeX } from 'lucide-react';
import { audioEngine } from './utils/audio';
import './App.css';

function App() {
  const [appState, setAppState] = useState<'home' | 'mode-select' | 'playing' | 'level-cleared' | 'level-failed' | 'gameover'>('home');
  const [gameMode, setGameMode] = useState<'normal' | 'timer' | 'randomizer'>('normal');

  const [gameLevel, setGameLevel] = useState<number>(1);
  const [gameScore, setGameScore] = useState<number>(0);
  const [gameLives, setGameLives] = useState<number>(3);
  const [timeLeft, setTimeLeft] = useState<number>(60);
  
  // High scores and streaks
  const [highestScore, setHighestScore] = useState<number>(0);
  const [highestStreak, setHighestStreak] = useState<number>(0);
  const [currentStreak, setCurrentStreak] = useState<number>(0);
  
  const [graph, setGraph] = useState<GameGraph>(new GameGraph());
  const [playerDrawnPath, setPlayerDrawnPath] = useState<NodeId[]>(['start']);
  const [optimalCost, setOptimalCost] = useState<number | null>(null);
  const [lastLevelDef, setLastLevelDef] = useState<LevelDef | null>(null);
  
  // Audio Settings
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(true);

  // Persistence: Load from localStorage
  useEffect(() => {
    const savedScore = localStorage.getItem('dijkstra_highest_score');
    const savedStreak = localStorage.getItem('dijkstra_highest_streak');
    const savedSound = localStorage.getItem('dijkstra_sound_enabled');
    
    if (savedScore) setHighestScore(parseInt(savedScore));
    if (savedStreak) setHighestStreak(parseInt(savedStreak));
    if (savedSound !== null) {
        const enabled = savedSound === 'true';
        setIsSoundEnabled(enabled);
        audioEngine.setEnabled(enabled);
    }
  }, []);

  // Persistence: Save to localStorage
  useEffect(() => {
    localStorage.setItem('dijkstra_highest_score', highestScore.toString());
    localStorage.setItem('dijkstra_highest_streak', highestStreak.toString());
    localStorage.setItem('dijkstra_sound_enabled', isSoundEnabled.toString());
    audioEngine.setEnabled(isSoundEnabled);
  }, [highestScore, highestStreak, isSoundEnabled]);

  // Load new level
  useEffect(() => {
     if (appState === 'playing') {
         // Normal mode logic: keep graph if it's a retry of the same level
         let levelDef: LevelDef;
         if (gameMode === 'normal' && lastLevelDef && lastLevelDef.levelNumber === gameLevel) {
             levelDef = lastLevelDef;
         } else {
             levelDef = generateRandomLevel(gameLevel);
             setLastLevelDef(levelDef);
         }

         setGraph(levelDef.graph);
         setPlayerDrawnPath([levelDef.startNode]);
         
         const optPath = levelDef.graph.findShortestPath(levelDef.startNode, levelDef.endNode);
         let cost = 0;
         for (let i = 0; i < optPath.length - 1; i++) {
             const edge = levelDef.graph.edges.get(optPath[i])?.find(e => e.to === optPath[i+1]);
             if (edge) cost += levelDef.graph.getCost(edge);
         }
         setOptimalCost(cost);

         // Reset timer if playing timer mode
         if (gameMode === 'timer') {
             // 60s base, -5s every 2 levels
             const countdown = Math.max(10, 60 - Math.floor((gameLevel - 1) / 2) * 5);
             setTimeLeft(countdown);
         }
     }
  }, [gameLevel, appState, gameMode]);

  // Timer logic
  useEffect(() => {
      if (appState === 'playing' && gameMode === 'timer') {
          const timer = setInterval(() => {
              setTimeLeft(prev => {
                  if (prev <= 1) {
                      handleRouteFailure();
                      return 0;
                  }
                  return prev - 1;
              });
          }, 1000);
          return () => clearInterval(timer);
      }
  }, [appState, gameMode]);

  const handleRouteFailure = () => {
      const newLives = gameLives - 1;
      setGameLives(newLives);
      setCurrentStreak(0); // Any failure kills the current streak
      
      if (newLives <= 0 || gameMode === 'randomizer') {
          // In randomizer, you lose everything on 1 life failure
          audioEngine.playGameOver();
          setAppState('gameover');
      } else {
          audioEngine.playLevelFail();
          setGameScore(s => Math.max(0, s - 50));
          setAppState('level-failed');
      }
  };

  const handleNodeClick = (nodeId: NodeId, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (appState !== 'playing') return;

    const lastNode = playerDrawnPath[playerDrawnPath.length - 1];
    if (nodeId === lastNode && playerDrawnPath.length > 1) {
        setPlayerDrawnPath(prev => prev.slice(0, -1));
        return;
    }

    const validEdges = graph.edges.get(lastNode);
    if (validEdges) {
        const edge = validEdges.find(e => e.to === nodeId);
        if (edge) {
            if (edge.isDirected === true && edge.to !== nodeId) return; // Direction check
            audioEngine.playClick();
            setPlayerDrawnPath(prev => [...prev, nodeId]);
        }
    }
  };

  const submitPlayerRoute = () => {
      let pCost = 0;
      let valid = true;

      for (let i = 0; i < playerDrawnPath.length - 1; i++) {
          const from = playerDrawnPath[i];
          const to = playerDrawnPath[i+1];
          const edge = graph.edges.get(from)?.find(e => e.to === to);
          if (!edge) { valid = false; break; }
          pCost += graph.getCost(edge);
      }

      if (valid && pCost <= (optimalCost || 0) && (optimalCost || 0) > 0) {
          audioEngine.playLevelWin();
          setAppState('level-cleared');
          
          let points = 500;
          if (gameMode === 'timer') {
              points += timeLeft * 10;
          }
          if (gameMode === 'randomizer') {
              const newStreak = currentStreak + 1;
              setCurrentStreak(newStreak);
              if (newStreak > highestStreak) setHighestStreak(newStreak);
              points += newStreak * 100; // Streak bonus
          }

          const newScore = gameScore + points;
          setGameScore(newScore);
          if (newScore > highestScore) setHighestScore(newScore);
      } else {
          handleRouteFailure();
      }
  };

  const startGame = (mode: 'normal' | 'timer' | 'randomizer') => {
      audioEngine.playClick();
      setGameMode(mode);
      setGameLevel(1);
      setGameScore(0);
      setGameLives(mode === 'randomizer' ? 1 : 3);
      setCurrentStreak(0);
      setLastLevelDef(null);
      setAppState('playing');
  }

  const handleGameOverRestart = () => {
    if (gameMode === 'normal') {
        // Find the last checkpoint (every 5 levels: 1, 6, 11...)
        const checkpoint = Math.floor((gameLevel - 1) / 5) * 5 + 1;
        setGameLevel(checkpoint);
        setGameLives(3);
        setLastLevelDef(null);
        setAppState('playing');
    } else {
        audioEngine.playClick();
        // Restart from level 1 for Timer and Randomizer modes
        startGame(gameMode);
    }
  }

  // Render Screens
  if (appState === 'home') {
      return (
          <div className="home-screen" style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', color: '#fff', position: 'relative' }}>
              <div 
                  onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                  style={{ position: 'absolute', top: '30px', right: '30px', cursor: 'pointer', opacity: 0.6, transition: '0.2s' }}
                  className="settings-toggle"
              >
                  {isSoundEnabled ? <Volume2 size={32} /> : <VolumeX size={32} color="#f85149" />}
              </div>
              
              <Navigation size={64} color="#a371f7" style={{ marginBottom: '20px' }} />
              <h1 style={{ fontSize: '48px', margin: '0 0 10px 0', letterSpacing: '1px' }}>Dijkstra<span style={{color: '#a371f7'}}>Quest</span></h1>
              <p style={{ fontSize: '18px', color: 'var(--text-secondary)', marginBottom: '40px' }}>Algorithm Pathfinding Challenge</p>
              
              <button 
                  onClick={() => {
                      audioEngine.playClick();
                      setAppState('mode-select');
                  }}
                  style={{ padding: '16px 48px', fontSize: '20px', fontWeight: 'bold', background: '#a371f7', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', boxShadow: '0 0 20px rgba(163,113,247,0.4)', transition: '0.2s', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
                  <Play size={24} fill="#fff" /> PLAY NOW
              </button>

              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '30px', borderRadius: '12px', width: '500px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}><BookOpen size={20} /> How to Play</h3>
                  <ul style={{ lineHeight: '1.6', fontSize: '15px', color: 'var(--text-secondary)' }}>
                      <li>Connect the <b>Start</b> node to the <b>End</b> node by clicking adjacent points.</li>
                      <li>Find the absolute <b>shortest path</b>. This game is powered by <b>Dijkstra's Algorithm</b> behind the scenes!</li>
                      <li>Every edge has a weight (cost). The total cost must flawlessly match the mathematically optimal route.</li>
                      <li>Submitting a sub-optimal route costs points and <b>1 Life</b>.</li>
                      <li>Levels generate procedurally forever! Try to get the highest score.</li>
                  </ul>
              </div>
          </div>
      );
  }

  if (appState === 'mode-select') {
    return (
        <div className="home-screen" style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', color: '#fff' }}>
            <h2 style={{ fontSize: '32px', marginBottom: '40px' }}>Select Game Mode</h2>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '1000px' }}>
                <div onClick={() => startGame('normal')} style={{ background: 'rgba(255,255,255,0.05)', padding: '30px', borderRadius: '12px', width: '250px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', transition: '0.2s' }} className="mode-card">
                    <Route size={40} color="#3fb950" style={{ marginBottom: '15px' }} />
                    <h3 style={{ margin: '0 0 10px 0' }}>Normal</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>Progress through levels with 3 lives. Checkpoints every 5 levels.</p>
                </div>
                <div onClick={() => startGame('timer')} style={{ background: 'rgba(255,255,255,0.05)', padding: '30px', borderRadius: '12px', width: '250px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', transition: '0.2s' }} className="mode-card">
                    <Clock size={40} color="#e3b341" style={{ marginBottom: '15px' }} />
                    <h3 style={{ margin: '0 0 10px 0' }}>Time Attack</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>Start with 60s. Time decreases every 2 levels. Can you keep up?</p>
                </div>
                <div onClick={() => startGame('randomizer')} style={{ background: 'rgba(255,255,255,0.05)', padding: '30px', borderRadius: '12px', width: '250px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', transition: '0.2s' }} className="mode-card">
                    <Zap size={40} color="#a371f7" style={{ marginBottom: '15px' }} />
                    <h3 style={{ margin: '0 0 10px 0' }}>Randomizer</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>1 Heart, random graph every time. How long is your streak?</p>
                </div>
            </div>
            <button onClick={() => {
                audioEngine.playClick();
                setAppState('home');
            }} style={{ marginTop: '40px', background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', fontSize: '16px' }}>&larr; Back</button>
        </div>
    );
  }

  // Playing / Level Cleared / Level Failed / Game Over
  return (
    <div className="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', background: 'var(--bg-color)', color: 'var(--text-primary)', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* HUD UI Panel */}
      <div className="ui-panel" style={{ position: 'relative' }}>
        <button 
            onClick={() => {
                audioEngine.playClick();
                setAppState('home');
            }}
            style={{ position: 'absolute', top: '15px', left: '15px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <ArrowLeft size={16} /> Menu
        </button>

        <div className="game-panel" style={{ marginTop: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                 <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>Level {gameLevel}</div>
                 <div style={{ display: 'flex', gap: '4px' }}>
                     {Array.from({length: Math.max(3, gameLives)}).map((_, i) => (
                         <Heart key={i} size={18} color={i < gameLives ? '#f85149' : '#555'} fill={i < gameLives ? '#f85149' : 'transparent'} />
                     ))}
                 </div>
            </div>
            
            <div className="dashboard-grid">
                <div className="dashboard-stat-box">
                    <div className="stat-value" style={{ color: '#e3b341' }}>{gameScore}</div>
                    <div className="stat-label">Score</div>
                </div>
                {gameMode === 'timer' && (
                    <div className="dashboard-stat-box" style={{ background: timeLeft < 10 ? 'rgba(248,81,73,0.2)' : 'rgba(255,255,255,0.05)', border: timeLeft < 10 ? '1px solid rgba(248,81,73,0.5)' : undefined }}>
                        <div className="stat-value" style={{ color: timeLeft < 10 ? '#f85149' : '#fff' }}>{timeLeft}s</div>
                        <div className="stat-label">Time Remaining</div>
                    </div>
                )}
                {gameMode === 'randomizer' && (
                    <div className="dashboard-stat-box">
                        <div className="stat-value" style={{ color: '#a371f7' }}>{currentStreak}</div>
                        <div className="stat-label">Streak</div>
                    </div>
                )}
            </div>

            {gameMode === 'randomizer' && (
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <div className="dashboard-stat-box" style={{ flex: 1, padding: '8px' }}>
                        <div className="stat-value" style={{ fontSize: '14px', color: '#8b949e' }}>{highestStreak}</div>
                        <div className="stat-label" style={{ fontSize: '10px' }}>Best Streak</div>
                    </div>
                    <div className="dashboard-stat-box" style={{ flex: 1, padding: '8px' }}>
                        <div className="stat-value" style={{ fontSize: '14px', color: '#8b949e' }}>{highestScore}</div>
                        <div className="stat-label" style={{ fontSize: '10px' }}>High Score</div>
                    </div>
                </div>
            )}

            <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '13px', margin: '15px 0' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}><Route size={14} /> Traced Path</div>
                <p style={{ margin: 0, wordBreak: 'break-all', color: 'var(--node-selected)' }}>
                    {playerDrawnPath.join(' → ')}
                </p>
            </div>

            <button 
                onClick={submitPlayerRoute}
                disabled={playerDrawnPath[playerDrawnPath.length-1] !== 'end' || appState !== 'playing'}
                style={{ width: '100%', padding: '14px', background: playerDrawnPath[playerDrawnPath.length-1] === 'end' ? '#a371f7' : '#555', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '15px', cursor: playerDrawnPath[playerDrawnPath.length-1] === 'end' ? 'pointer' : 'not-allowed', transition: '0.2s', boxShadow: playerDrawnPath[playerDrawnPath.length-1] === 'end' ? '0 0 15px rgba(163,113,247,0.4)' : 'none' }}>
                Submit Route
            </button>
            
            {appState === 'playing' && (
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '12px', textAlign: 'center' }}>Click adjacent nodes on the map to draft your route.</p>
            )}
        </div>
      </div>

      <div className="graph-board" style={{ overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%' }}>
            {/* SVG for Edges */}
            <svg className="edges-layer">
            <defs>
                <marker id="arrow-default" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b949e" />
                </marker>
                <marker id="arrow-player" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#a371f7" />
                </marker>
            </defs>
            {Array.from(graph.edges.entries()).map(([fromId, edges]) => {
                const fromNode = graph.nodes.get(fromId);
                if (!fromNode) return null;
                
                return edges.map(edge => {
                if (!edge.isDirected && fromId > edge.to) return null;

                const toNode = graph.nodes.get(edge.to);
                if (!toNode) return null;

                const isPlayerPath = appState === 'playing' && playerDrawnPath.some((nodeId, idx) => 
                                    (nodeId === fromId && playerDrawnPath[idx+1] === edge.to) ||
                                    (!edge.isDirected && nodeId === edge.to && playerDrawnPath[idx+1] === fromId)
                                );
                
                let strokeColor = 'var(--edge-default)';
                let strokeWidth = 2;
                let markerEndMode = 'default';

                if (isPlayerPath) {
                    strokeColor = '#a371f7'; // Purple for player path
                    strokeWidth = 4;
                    markerEndMode = 'player';
                }

                return (
                    <g key={`${fromId}-${edge.to}`}>
                    <line 
                        x1={fromNode.x} y1={fromNode.y} 
                        x2={toNode.x} y2={toNode.y} 
                        stroke={strokeColor} 
                        strokeWidth={strokeWidth}
                        markerEnd={edge.isDirected ? `url(#arrow-${markerEndMode})` : undefined} 
                    />
                    </g>
                );
                });
            })}
            </svg>

            {/* Edge Cost Labels */}
            {Array.from(graph.edges.entries()).map(([fromId, edges]) => {
            const fromNode = graph.nodes.get(fromId);
            if (!fromNode) return null;
            
            return edges.map(edge => {
                if (!edge.isDirected && fromId > edge.to) return null;

                const toNode = graph.nodes.get(edge.to);
                if (!toNode) return null;

                let midX = (fromNode.x + toNode.x) / 2;
                let midY = (fromNode.y + toNode.y) / 2;
                
                // Offset label slightly if it's a directed edge to avoid overlapping with reverse path
                if (edge.isDirected) {
                    const dx = toNode.x - fromNode.x;
                    const dy = toNode.y - fromNode.y;
                    const len = Math.hypot(dx, dy);
                    if (len > 0) {
                        midX += (-dy / len) * 12;
                        midY += (dx / len) * 12;
                    }
                }
                const cost = graph.getCost(edge);
                
                const isPlayerPath = appState === 'playing' && playerDrawnPath.some((nodeId, idx) => 
                                    (nodeId === fromId && playerDrawnPath[idx+1] === edge.to) ||
                                    (!edge.isDirected && nodeId === edge.to && playerDrawnPath[idx+1] === fromId)
                                );

                return (
                <div 
                    key={`label-${fromId}-${edge.to}`}
                    className={`edge-weight-label ${isPlayerPath ? 'is-path' : ''}`}
                    style={{ left: midX, top: midY, pointerEvents: 'none' }}
                >
                    {cost}
                </div>
                );
            });
            })}

            {/* Nodes */}
            <div className="nodes-layer">
            {Array.from(graph.nodes.values()).map(node => {
                const isPlayerSelected = appState === 'playing' && playerDrawnPath.includes(node.id);

                return (
                    <div 
                    key={node.id}
                    className={`game-node ${isPlayerSelected ? 'is-player-path' : ''}`}
                    style={{ left: node.x, top: node.y, cursor: 'pointer' }}
                    onClick={(e) => handleNodeClick(node.id, e)}
                    >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', position: 'relative' }}>
                        {node.id === 'start' ? <Play size={20} /> : node.id === 'end' ? <MapPin size={20} /> : <div style={{width:10, height:10, background: '#fff', borderRadius:'50%'}}></div>}
                        <span style={{ fontSize: '10px' }}>{node.label}</span>
                    </div>
                    </div>
                );
            })}
            </div>
        </div>
      </div>

      {appState === 'level-cleared' && (
          <div className="success-overlay is-visible" style={{ flexDirection: 'column', gap: '20px' }}>
             <Star size={80} color="#e3b341" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 10px rgba(227, 179, 65, 0.5))' }} />
             <h2 style={{ fontSize: '32px', margin: 0 }}>Level Cleared!</h2>
             <p style={{ fontSize: '16px', opacity: 0.8, margin: 0 }}>Optimal route matched. City traffic flowing smoothly.</p>
             <button 
                 onClick={() => {
                     setGameLevel(l => l + 1);
                     setAppState('playing');
                 }}
                 style={{ marginTop: '20px', padding: '12px 30px', fontSize: '18px', background: '#3fb950', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 0 15px rgba(63, 185, 80, 0.4)' }}>
                 Next Level
             </button>
          </div>
      )}

      {appState === 'level-failed' && (
          <div className="success-overlay is-visible" style={{ flexDirection: 'column', gap: '20px' }}>
             <AlertCircle size={80} color="#f85149" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 10px rgba(248, 81, 73, 0.5))' }} />
             <h2 style={{ fontSize: '32px', margin: 0, color: '#f85149' }}>Route Failed!</h2>
             <p style={{ fontSize: '16px', opacity: 0.8, margin: 0 }}>Your route was sub-optimal. You lost a life.</p>
             <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
                 <button 
                     onClick={() => {
                         setPlayerDrawnPath(['start']); 
                         if (gameMode === 'timer') {
                             const countdown = Math.max(10, 60 - Math.floor((gameLevel - 1) / 2) * 5);
                             setTimeLeft(countdown);
                         }
                         setAppState('playing');
                     }}
                     style={{ padding: '12px 30px', fontSize: '18px', background: '#3fb950', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 0 15px rgba(63, 185, 80, 0.4)' }}>
                     Try Again
                 </button>
                 <button 
                     onClick={() => {
                         audioEngine.playClick();
                         setAppState('home');
                     }}
                     style={{ padding: '12px 30px', fontSize: '18px', background: '#30363d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
                     Main Menu
                 </button>
             </div>
          </div>
      )}

      {appState === 'gameover' && (
          <div className="success-overlay is-visible" style={{ flexDirection: 'column', gap: '20px', background: 'rgba(20,0,0,0.9)' }}>
             <AlertCircle size={80} color="#f85149" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 10px rgba(248, 81, 73, 0.5))' }} />
             <h2 style={{ fontSize: '32px', margin: 0, color: '#f85149' }}>GAME OVER</h2>
             <p style={{ fontSize: '16px', opacity: 0.8, margin: 0 }}>
                 {gameMode === 'normal' 
                    ? `You lost all lives. Restarting from level ${Math.floor((gameLevel - 1) / 5) * 5 + 1}.` 
                    : 'Your logistics contract has been terminated.'}
             </p>
             {gameMode === 'randomizer' && (
                 <div style={{ display: 'flex', gap: '20px', fontSize: '20px' }}>
                    <div>Streak: <span style={{color: '#a371f7'}}>{currentStreak}</span></div>
                    <div>Score: <span style={{color: '#e3b341'}}>{gameScore}</span></div>
                 </div>
             )}
             <div style={{ display: 'flex', gap: '15px' }}>
                <button 
                    onClick={handleGameOverRestart}
                    style={{ marginTop: '20px', padding: '12px 30px', fontSize: '18px', background: '#f85149', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 0 15px rgba(248, 81, 73, 0.4)' }}>
                    {gameMode === 'normal' ? 'Restart from Checkpoint' : 'Try Again'}
                </button>
                <button 
                    onClick={() => {
                        audioEngine.playClick();
                        setAppState('home');
                    }}
                    style={{ marginTop: '20px', padding: '12px 30px', fontSize: '18px', background: '#30363d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
                    Main Menu
                </button>
             </div>
          </div>
      )}
    </div>
  );
}

export default App;
