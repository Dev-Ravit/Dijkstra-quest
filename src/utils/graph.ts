export type NodeId = string;

export interface Point {
  x: number;
  y: number;
}

export interface Node extends Point {
  id: NodeId;
  label: string;
  isChargingStation?: boolean;
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  weight: number;
  penalty?: number; 
  isDirected?: boolean;
}

export interface DijkstraStep {
  currentStage: 'init' | 'evaluating' | 'finished' | 'no-path';
  message: string;
  distances: Map<NodeId, number>;
  previous: Map<NodeId, NodeId | null>;
  unvisited: Set<NodeId>;
  visited: Set<NodeId>;
  currentNode: NodeId | null;
  evaluatingEdge: Edge | null;
  path: NodeId[];
}

export class GameGraph {
  nodes: Map<NodeId, Node>;
  edges: Map<NodeId, Edge[]>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  clone(): GameGraph {
    const newGraph = new GameGraph();
    this.nodes.forEach(n => newGraph.addNode({ ...n }));
    for (const [from, edges] of this.edges.entries()) {
      edges.forEach(e => {
        const existing = newGraph.edges.get(from)?.find(ex => ex.to === e.to);
        if (!existing) {
             newGraph.addEdge(e.from, e.to, e.weight, e.isDirected);
             if (e.penalty) {
                newGraph.setEdgePenalty(e.from, e.to, e.penalty);
             }
        }
      });
    }
    return newGraph;
  }

  addNode(node: Node) {
    this.nodes.set(node.id, node);
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, []);
    }
  }

  addEdge(from: NodeId, to: NodeId, weight: number, isDirected: boolean = false) {
    this.edges.get(from)?.push({ from, to, weight, isDirected });
    if (!isDirected) {
      this.edges.get(to)?.push({ from: to, to: from, weight, isDirected: false });
    }
  }

  removeNode(nodeId: NodeId) {
    this.nodes.delete(nodeId);
    this.edges.delete(nodeId);
    for (const [, edges] of this.edges.entries()) {
      const idx = edges.findIndex(e => e.to === nodeId);
      if (idx !== -1) edges.splice(idx, 1);
    }
  }

  removeEdge(from: NodeId, to: NodeId) {
    const fromEdges = this.edges.get(from);
    if (fromEdges) {
      const idx = fromEdges.findIndex(e => e.to === to);
      if (idx !== -1) fromEdges.splice(idx, 1);
    }
    const toEdges = this.edges.get(to);
    if (toEdges) {
      const idx = toEdges.findIndex(e => e.to === from);
      if (idx !== -1) toEdges.splice(idx, 1);
    }
  }

  setEdgePenalty(from: NodeId, to: NodeId, penalty: number) {
    const applyPenalty = (source: NodeId, target: NodeId) => {
      const edges = this.edges.get(source);
      if (edges) {
        const edge = edges.find((e) => e.to === target);
        if (edge) edge.penalty = penalty;
      }
    };
    applyPenalty(from, to);
    applyPenalty(to, from);
  }

  toggleEdgePenalty(from: NodeId, to: NodeId, penalty: number) {
    // Toggles the penalty on an edge. If it exists, remove it. If not, add it.
    let isPenalized = false;
    
    const applyToggle = (source: NodeId, target: NodeId) => {
      const edges = this.edges.get(source);
      if (edges) {
        const edge = edges.find((e) => e.to === target);
        if (edge) {
          if (edge.penalty && edge.penalty > 0) {
            edge.penalty = 0;
            isPenalized = false;
          } else {
            edge.penalty = penalty;
            isPenalized = true;
          }
        }
      }
    };

    applyToggle(from, to);
    applyToggle(to, from);
    return isPenalized;
  }

  getCost(edge: Edge): number {
    return edge.weight + (edge.penalty || 0);
  }

  // Instant Dijkstra (For normal interaction)
  findShortestPath(startId: NodeId, endId: NodeId): NodeId[] {
    const generator = this.dijkstraGenerator(startId, endId);
    let result = generator.next();
    let lastPath: NodeId[] = [];
    while (!result.done) {
      if (result.value && result.value.path) {
          lastPath = result.value.path;
      }
      result = generator.next();
    }
    return lastPath;
  }

  // Step-by-step Generator for Visualization
  *dijkstraGenerator(startId: NodeId, goalId: NodeId, batteryLimit: number = 20): Generator<DijkstraStep, void, void> {
    const distances = new Map<NodeId, number>();
    const battery = new Map<NodeId, number>(); // Track battery level at each node
    const previous = new Map<NodeId, NodeId | null>();
    const unvisited = new Set<NodeId>();
    const visited = new Set<NodeId>();

    // Initialize all distances to Infinity, battery to -1 (or 0 for unreachable)
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, Infinity);
      battery.set(nodeId, 0); // 0 indicates no battery or unreachable
      previous.set(nodeId, null);
      unvisited.add(nodeId);
    }

    distances.set(startId, 0);
    battery.set(startId, batteryLimit); // Start with full battery

    yield {
      currentStage: 'init',
      message: `Initialized algorithm. Distances to all nodes set to Infinity, except Start Node '${startId}' which is 0. Battery at start node is ${batteryLimit}.`,
      distances: new Map(distances),
      previous: new Map(previous),
      unvisited: new Set(unvisited),
      visited: new Set(visited),
      currentNode: null,
      evaluatingEdge: null,
      path: [],
    };

    while (unvisited.size > 0) {
      // Find unvisited node with smallest distance
      let currentLoc: NodeId | null = null;
      let minDistance = Infinity;

      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId)!;
        if (dist < minDistance) {
          minDistance = dist;
          currentLoc = nodeId;
        }
      }

      if (currentLoc === null || minDistance === Infinity) {
        yield {
          currentStage: 'no-path',
          message: 'No reachable nodes left. Path cannot be found.',
          distances: new Map(distances),
          previous: new Map(previous),
          unvisited: new Set(unvisited),
          visited: new Set(visited),
          currentNode: null,
          evaluatingEdge: null,
          path: []
        };
        return; // No more reachable nodes
      }

      // We reached the actual destination with valid battery
      if (currentLoc === goalId) {
        // Do not delete from unvisited yet, let the loop finish to reconstruct path
        break;
      }

      unvisited.delete(currentLoc);
      visited.add(currentLoc);

      yield {
        currentStage: 'evaluating',
        message: `Selected Node '${currentLoc}' as it has the smallest known distance (${minDistance}). Current EV Battery: ${battery.get(currentLoc)}. Exploring neighbors...`,
        distances: new Map(distances),
        previous: new Map(previous),
        unvisited: new Set(unvisited),
        visited: new Set(visited),
        currentNode: currentLoc,
        evaluatingEdge: null,
        path: [],
      };

      const neighbors = this.edges.get(currentLoc) || [];

      for (const edge of neighbors) {
        const neighbor = edge.to;
        if (!unvisited.has(neighbor)) continue;

        yield {
          currentStage: 'evaluating',
          message: `Checking edge from '${edge.from}' to '${edge.to}' with cost ${this.getCost(edge)}.`,
          distances: new Map(distances),
          previous: new Map(previous),
          unvisited: new Set(unvisited),
          visited: new Set(visited),
          currentNode: currentLoc,
          evaluatingEdge: edge,
          path: [],
        };

        const currentBattery = battery.get(currentLoc)!;
        const totalCostToTakeEdge = this.getCost(edge);
        
        // Blockages are infinite cost (999)
        if (totalCostToTakeEdge >= 999) continue;
        
        let newBatteryLevel = currentBattery - totalCostToTakeEdge;
        
        // If route runs out of fuel BEFORE reaching the neighbor, route is invalid
        if (newBatteryLevel < 0) {
          yield {
            currentStage: 'evaluating',
            message: `Cannot traverse edge from '${edge.from}' to '${edge.to}'. Not enough battery.`,
            distances: new Map(distances),
            previous: new Map(previous),
            unvisited: new Set(unvisited),
            visited: new Set(visited),
            currentNode: currentLoc,
            evaluatingEdge: edge,
            path: [],
          };
          continue;
        }

        // If neighbor is a charging station, battery restores to max
        const isTargetChargingStation = this.nodes.get(neighbor)?.isChargingStation;
        if (isTargetChargingStation) {
            newBatteryLevel = batteryLimit;
        }

        const currentKnownDistance = distances.get(neighbor)!;
        const proposedDistance = distances.get(currentLoc)! + totalCostToTakeEdge;

        // Replace if cheaper, OR if equal but leaves higher battery
        if (proposedDistance < currentKnownDistance || (proposedDistance === currentKnownDistance && newBatteryLevel > battery.get(neighbor)!)) {
          distances.set(neighbor, proposedDistance);
          battery.set(neighbor, newBatteryLevel);
          previous.set(neighbor, currentLoc);
          
          yield {
            currentStage: 'evaluating',
            message: `Found shorter path to '${edge.to}'! Updated known distance to ${proposedDistance}.`,
            distances: new Map(distances),
            previous: new Map(previous),
            unvisited: new Set(unvisited),
            visited: new Set(visited),
            currentNode: currentLoc,
            evaluatingEdge: edge,
            path: [],
          };
        }
      }
    }

    // Reconstruct path
    const path: NodeId[] = [];
    let current: NodeId | null = goalId;
    
    if (distances.get(goalId) === Infinity) {
      yield {
        currentStage: 'no-path',
        message: `Destination '${goalId}' is unreachable!`,
        distances: new Map(distances), 
        previous: new Map(previous), 
        unvisited: new Set(unvisited), 
        visited: new Set(visited), 
        currentNode: null, 
        evaluatingEdge: null, 
        path: []
      };
      return;
    }

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current)!;
    }

    yield {
      currentStage: 'finished',
      message: `Destination '${goalId}' reached! Shortest path calculated with total cost of ${distances.get(goalId)} and remaining EV Battery: ${battery.get(goalId)}.`,
      distances: new Map(distances), 
      previous: new Map(previous), 
      unvisited: new Set(unvisited), 
      visited: new Set(visited), 
      currentNode: null, 
      evaluatingEdge: null,
      path
    };
  }

  // Finds a Hamiltonian Path or Circuit using Backtracking DFS
  findHamiltonian(): { type: 'circuit' | 'path' | 'none', path: NodeId[], message: string } {
    const nodes = Array.from(this.nodes.keys());
    if (nodes.length <= 1) return { type: 'none', path: [], message: 'Graph is too small to have a Hamiltonian path.' };

    let foundPath: NodeId[] | null = null;
    let foundCircuit: NodeId[] | null = null;

    const backtrack = (currentPath: NodeId[]) => {
      if (foundCircuit) return;

      if (currentPath.length === nodes.length) {
        const firstNode = currentPath[0];
        const lastNode = currentPath[currentPath.length - 1];
        
        // Is there an edge from last to first to form a circuit? (Excluding blocked paths)
        const hasOutEdge = (this.edges.get(lastNode) || [])
          .some(e => e.to === firstNode && this.getCost(e) < 999);
        
        if (hasOutEdge) {
            foundCircuit = [...currentPath, firstNode];
        } else if (!foundPath) {
            foundPath = [...currentPath]; 
        }
        return;
      }

      const lastVisited = currentPath[currentPath.length - 1];
      const neighbors = this.edges.get(lastVisited) || [];

      for (const edge of neighbors) {
        if (this.getCost(edge) >= 999) continue; // Skip blocked edges
        if (!currentPath.includes(edge.to)) {
           currentPath.push(edge.to);
           backtrack(currentPath);
           currentPath.pop();
        }
      }
    };

    // Try starting from every node
    for (const startNode of nodes) {
       if (foundCircuit) break;
       backtrack([startNode]);
    }

    if (foundCircuit) {
        return { type: 'circuit', path: foundCircuit, message: 'Hamiltonian Circuit Found! (Visits every node exactly once and returns to the start)' };
    } else if (foundPath) {
        return { type: 'path', path: foundPath, message: 'Hamiltonian Path Found! (Visits every node exactly once, but does not form a loop)' };
    } else {
        return { type: 'none', path: [], message: 'No Hamiltonian Path or Circuit exists in this graph.' };
    }
  }

  // Find Euler Path using Hierholzer's Algorithm
  findEulerPath(): { path: NodeId[], message: string } {
    let oddDegreeNodes: NodeId[] = [];
    
    // Ignore edges that are completely blocked (hazards)
    const validEdges = new Map<NodeId, NodeId[]>();
    for (const [from, edges] of this.edges.entries()) {
        const connectedTo = edges.filter(e => this.getCost(e) < 999).map(e => e.to);
        validEdges.set(from, connectedTo);
        if (connectedTo.length % 2 !== 0) {
            oddDegreeNodes.push(from);
        }
    }

    if (oddDegreeNodes.length !== 0 && oddDegreeNodes.length !== 2) {
      return { path: [], message: `No Euler Path possible. Graph has ${oddDegreeNodes.length} nodes with an odd number of edges.` };
    }

    // If edges exist, start at an odd node, otherwise pick any node with edges
    let startNode = oddDegreeNodes.length === 2 ? oddDegreeNodes[0] : Array.from(validEdges.keys()).find(k => validEdges.get(k)!.length > 0);
    
    if (!startNode) return { path: [], message: "Graph has no edges to traverse." };

    let edgeCount = new Map<NodeId, Map<NodeId, number>>();
    for (const [from, toNodes] of validEdges.entries()) {
        if (!edgeCount.has(from)) edgeCount.set(from, new Map());
        for (const to of toNodes) {
            edgeCount.get(from)!.set(to, (edgeCount.get(from)!.get(to) || 0) + 1);
        }
    }
    
    let currentPath: NodeId[] = [startNode];
    let circuit: NodeId[] = [];
    
    while(currentPath.length > 0) {
        let currV = currentPath[currentPath.length - 1];
        let edgesMap = edgeCount.get(currV);
        let hasRemainingEdges = false;
        
        if (edgesMap) {
            for (const [nextV, count] of edgesMap.entries()) {
                 if (count > 0) {
                     edgeCount.get(currV)!.set(nextV, count - 1);
                     edgeCount.get(nextV)!.set(currV, edgeCount.get(nextV)!.get(currV)! - 1); 
                     currentPath.push(nextV);
                     hasRemainingEdges = true;
                     break;
                 }
            }
        }
        
        if (!hasRemainingEdges) {
            circuit.push(currentPath.pop()!);
        }
    }
    
    circuit.reverse();
    const type = oddDegreeNodes.length === 0 ? "Eulerian Circuit" : "Eulerian Path";
    return { path: circuit, message: `Found ${type}! Trace exactly covers every path.` };
  }
}
