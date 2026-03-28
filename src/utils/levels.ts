import { GameGraph } from './graph';

export interface LevelDef {
    levelNumber: number;
    graph: GameGraph;
    title: string;
    description: string;
    startNode: string;
    endNode: string;
}

export const generateRandomLevel = (level: number): LevelDef => {
    const g = new GameGraph();
    
    // Add base nodes for all levels
    g.addNode({ id: 'start', label: 'start', x: 100, y: 300 });
    g.addNode({ id: 'end', label: 'end', x: 700, y: 300 });

    // Node count increases with level (starts easy: ~5 intermediate, gets up to ~20)
    const numIntermediateNodes = Math.min(20, 3 + Math.floor(level * 1.5));
    const nodes: { id: string, label: string, x: number, y: number }[] = [];

    // Scatter nodes across canvas avoiding overlap
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < numIntermediateNodes; i++) {
        const id = labels[i % labels.length] + (i >= labels.length ? i.toString() : '');
        let x = 0, y = 0, valid = false, attempts = 0;
        let minDistance = 140; // Start with a strict 140px separation
        
        while (!valid && attempts < 200) {
            x = 180 + Math.random() * 440; // X: 180 to 620
            y = 80 + Math.random() * 440;  // Y: 80 to 520
            valid = true;
            
            // Check collision with other nodes
            const allNodes = [...nodes, {id: 'start', x: 100, y: 300}, {id: 'end', x: 700, y: 300}];
            for (const n of allNodes) {
                if (Math.hypot(n.x - x, n.y - y) < minDistance) {
                    valid = false; break;
                }
            }
            attempts++;
            // Relax constraints if we struggle to place a node (occurs in higher levels)
            if (attempts % 20 === 0 && minDistance > 70) {
                minDistance -= 10;
            }
        }
        
        g.addNode({ id, label: id, x, y });
        nodes.push({ id, label: id, x, y });
    }

    // Connect Start to a few leftmost nodes
    const sortedByX = [...nodes].sort((a, b) => a.x - b.x);
    for (let i = 0; i < Math.min(3, sortedByX.length); i++) {
        g.addEdge('start', sortedByX[i].id, Math.floor(Math.random() * 10) + 1);
    }

    // Connect End to a few rightmost nodes
    for (let i = sortedByX.length - 1; i >= Math.max(0, sortedByX.length - 3); i--) {
        g.addEdge(sortedByX[i].id, 'end', Math.floor(Math.random() * 10) + 1);
    }

    // Randomly connect intermediate nodes to build a tight web
    for (let i = 0; i < nodes.length; i++) {
        // Find 2 nearest neighbors
        const distances = nodes.map(n => ({
            id: n.id,
            dist: Math.sqrt(Math.pow(n.x - nodes[i].x, 2) + Math.pow(n.y - nodes[i].y, 2))
        })).filter(n => n.id !== nodes[i].id).sort((a, b) => a.dist - b.dist);

        for (let j = 0; j < Math.min(2, distances.length); j++) {
            // Avoid adding duplicate edges if one already exists
            const existingEdge = g.edges.get(nodes[i].id)?.find(e => e.to === distances[j].id);
            if (!existingEdge) {
                // Occasional directed edges at higher levels
                const isDirected = level > 3 && Math.random() > 0.7;
                g.addEdge(nodes[i].id, distances[j].id, Math.floor(Math.random() * 15) + 1, isDirected);
            }
        }
    }

    return { 
        levelNumber: level, 
        graph: g, 
        title: `Stage ${level}`, 
        description: 'Find the mathematically shortest path to the destination!', 
        startNode: 'start', 
        endNode: 'end' 
    };
};
