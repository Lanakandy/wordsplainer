// script.js - FINAL POLISHED VERSION

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Refs ---
    const languageModal = document.getElementById('language-modal');
    const languageList = document.getElementById('language-list');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const graphContainer = document.getElementById('graph-container');
    const controlsDock = document.getElementById('controls-dock');
    const zoomControls = document.getElementById('zoom-controls');
    const registerToggleBtn = document.getElementById('register-toggle-btn');
    const tooltip = document.getElementById('graph-tooltip');
    const svg = d3.select("#wordsplainer-graph-svg");
    const graphGroup = svg.append("g");
    const SNAP_OFF_THRESHOLD = 120;

    // --- Enhanced State Management ---
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let currentActiveCentral = null;
    let currentView = 'meaning';
    let currentRegister = 'conversational';
    let viewState = { offset: 0, hasMore: true };

// --- Enhanced positioning system ---
    const CLUSTER_SPACING = 600; // Minimum distance between central nodes
    const NODE_SPACING = 180; // Distance from central to satellite nodes
    const RECT_NODE_MARGIN = 15; // Extra margin for rectangular nodes

    // --- Central API fetching function ---
    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
        try {
            console.log(`Fetching data: ${word}, ${type}, register: ${currentRegister}`);
            const response = await fetch('/.netlify/functions/wordsplainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word, type, offset, limit, language, register: currentRegister }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error("fetchData error:", error);
            throw new Error(`Failed to fetch ${type} for "${word}": ${error.message}`);
        }
    }

    // Enhanced collision detection for better node placement
    function findOptimalPosition(targetX, targetY, existingNodes, nodeRadius = 80) {
        const candidates = [];
        const step = Math.PI / 8; // 16 directions
        
        for (let radius = nodeRadius; radius <= nodeRadius * 3; radius += 40) {
            for (let angle = 0; angle < Math.PI * 2; angle += step) {
                const x = targetX + Math.cos(angle) * radius;
                const y = targetY + Math.sin(angle) * radius;
                
                const hasCollision = existingNodes.some(node => {
                    const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
                    const minDist = (node.width || 30) / 2 + nodeRadius + RECT_NODE_MARGIN;
                    return dist < minDist;
                });
                
                if (!hasCollision) {
                    candidates.push({ x, y, distance: radius });
                }
            }
            if (candidates.length > 0) break;
        }
        
        return candidates.length > 0 
            ? candidates.sort((a, b) => a.distance - b.distance)[0]
            : { x: targetX, y: targetY };
    }

    // Smart central node positioning
    function findOptimalCentralPosition(sourceNode = null) {
        const { width, height } = graphContainer.getBoundingClientRect();
        const currentTransform = d3.zoomTransform(svg.node());
        
        if (centralNodes.length === 0) {
            return { x: width / 2, y: height / 2 };
        }
        
        if (sourceNode && typeof sourceNode.x === 'number') {
            // Position new central node relative to source
            const baseX = sourceNode.x + CLUSTER_SPACING;
            const baseY = sourceNode.y;
            
            // Check for collisions with existing centrals
            const existingCentrals = centralNodes.filter(n => n.visible !== false);
            const optimal = findOptimalPosition(baseX, baseY, existingCentrals, 100);
            return optimal;
        }
        
        // Position in viewport center, transformed to graph coordinates
        return {
            x: (width / 2 - currentTransform.x) / currentTransform.k,
            y: (height / 2 - currentTransform.y) / currentTransform.k
        };
    }

    // Enhanced force simulation with better collision handling
    function forceCluster() {
        let strength = 0.15;
        return function(alpha) {
            const allNodes = getConsolidatedGraphData().nodes.filter(n => n.visible !== false);
            
            for (let node of allNodes) {
                if (node.clusterId && graphClusters.has(node.clusterId)) {
                    const cluster = graphClusters.get(node.clusterId);
                    const target = cluster.center;
                    
                    // Stronger clustering for rectangular nodes
                    const clusterStrength = node.type && ['meaning', 'example', 'context', 'idioms'].includes(node.type) 
                        ? strength * 1.5 : strength;
                    
                    node.vx += (target.x - node.x) * clusterStrength * alpha;
                    node.vy += (target.y - node.y) * clusterStrength * alpha;
                }
            }
        };
    }

    // Enhanced collision force
    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(d => {
            const textBoxTypes = ['meaning', 'example', 'context', 'idioms'];
            return textBoxTypes.includes(d.target.type) ? NODE_SPACING * 0.8 : NODE_SPACING;
        }))
        .force("charge", d3.forceManyBody().strength(d => {
            if (d.isCentral) return -600;
            const textBoxTypes = ['meaning', 'example', 'context', 'idioms'];
            return textBoxTypes.includes(d.type) ? -300 : -400;
        }))
        .force("collision", d3.forceCollide().radius(d => {
            if (d.isCentral) return 50;
            if (d.width && d.height) {
                return Math.sqrt(d.width ** 2 + d.height ** 2) / 2 + RECT_NODE_MARGIN;
            }
            return 25;
        }).strength(0.8))
        .force("cluster", forceCluster())
        .force("center", d3.forceCenter())
        // Add radial force to spread nodes around centrals
        .force("radial", d3.forceRadial().radius(NODE_SPACING).strength(0.1));

    const zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on("zoom", (event) => {
        graphGroup.attr("transform", event.transform);
    });
    svg.call(zoomBehavior);

    function renderInitialPrompt() {
        simulation.stop();
        centralNodes = [];
        graphClusters.clear();
        crossConnections = [];
        currentActiveCentral = null;
        graphGroup.selectAll("*").remove();
        const { width, height } = graphContainer.getBoundingClientRect();
        const promptGroup = graphGroup.append("g").attr("class", "node central-node").style("cursor", "pointer").on("click", promptForInitialWord);
        promptGroup.append("circle").attr("cx", width / 2).attr("cy", height / 2).attr("r", 40);
        promptGroup.append("text").attr("class", "sub-text").attr("x", width / 2).attr("y", height / 2).attr("dy", "0.1em").text("+");
        promptGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 70).text("Add a word to explore");
    }

    function renderLoading(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();
        const loadingGroup = graphGroup.append("g");
        loadingGroup.append("circle").attr("class", "loading-spinner").attr("cx", width / 2).attr("cy", height / 2 - 30).attr("r", 20);
        loadingGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 30).text(message);
    }

    function renderError(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();
        graphGroup.append("text").attr("class", "status-text error-text").attr("x", width / 2).attr("y", height / 2).text(message);
    }

    function getConsolidatedGraphData() {
        let nodes = [], links = [];
        for (const cluster of graphClusters.values()) {
            nodes.push(...cluster.nodes);
            links.push(...cluster.links);
        }
        return { nodes, links: [...links, ...crossConnections] };
    }

// Enhanced node positioning for new nodes
    function positionNewNodes(cluster, newNodes) {
        const centralNode = cluster.nodes.find(n => n.isCentral);
        if (!centralNode) return;

        const existingNodes = cluster.nodes.filter(n => n.visible !== false && !n.isCentral);
        
        newNodes.forEach((node, index) => {
            if (node.isCentral || node.type === 'add') return;
            
            // Calculate initial position around central node
            const angle = (index * (Math.PI * 2)) / Math.max(newNodes.length, 4);
            const baseDistance = NODE_SPACING + (node.width || 0) / 2;
            
            const targetX = centralNode.x + Math.cos(angle) * baseDistance;
            const targetY = centralNode.y + Math.sin(angle) * baseDistance;
            
            // Find collision-free position
            const optimal = findOptimalPosition(targetX, targetY, existingNodes, (node.width || 40) / 2);
            
            node.x = optimal.x;
            node.y = optimal.y;
            
            // Set initial velocity to reduce jitter
            node.vx = (optimal.x - centralNode.x) * 0.01;
            node.vy = (optimal.y - centralNode.y) * 0.01;
        });
    }

    function updateGraph() {
        const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();
        const visibleNodes = allNodes.filter(n => n.visible !== false);
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const visibleLinks = allLinks.filter(l => visibleNodeIds.has(l.source.id || l.source) && visibleNodeIds.has(l.target.id || l.target));
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll(".status-text, .prompt-plus, .loading-spinner").remove();
        const textBoxTypes = ['meaning', 'example', 'context', 'idioms'];

        // Enhanced link rendering
        graphGroup.selectAll(".link")
            .data(visibleLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
            .join(
                enter => enter.append("line")
                    .attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`)
                    .style("opacity", 0)
                    .transition().duration(600).style("opacity", 1),
                update => update.attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`),
                exit => exit.transition().duration(300).style("opacity", 0).remove()
            );

        // Enhanced node rendering with better positioning
        graphGroup.selectAll(".node")
            .data(visibleNodes, d => d.id)
            .join(
                enter => {
                    const nodeGroup = enter.append("g")
                        .call(d3.drag()
                            .on("start", dragstarted)
                            .on("drag", dragged)
                            .on("end", dragended)
                            .filter(event => {
                                const d = event.subject;
                                // Allow dragging of rectangular nodes, but with constraints
                                return !event.target.classList.contains('interactive-word') && 
                                       (!textBoxTypes.includes(d.type) || event.ctrlKey || event.metaKey);
                            }))
                        .on("mouseover", handleMouseOver)
                        .on("mouseout", handleMouseOut)
                        .on("click", handleNodeClick);

                    // Create appropriate shape
                    nodeGroup.append(d => 
                        textBoxTypes.includes(d.type) 
                            ? document.createElementNS(d3.namespaces.svg, 'rect')
                            : document.createElementNS(d3.namespaces.svg, 'circle')
                    );

                    // Animate circle nodes
                    nodeGroup.select("circle")
                        .attr("r", 0)
                        .transition()
                        .duration(400)
                        .ease(d3.easeElasticOut.amplitude(1).period(0.5))
                        .attr("r", d => d.isCentral ? 40 : 15);

                    // Initially hide rectangular backgrounds
                    nodeGroup.select("rect").style("opacity", 0);
                    
                    nodeGroup.append("text");
                    
                    // Smooth entrance animation
                    nodeGroup
                        .style("opacity", 0)
                        .transition()
                        .duration(300)
                        .delay((d, i) => i * 50) // Stagger animations
                        .style("opacity", 1);
                    
                    return nodeGroup;
                },
                update => update,
                exit => exit
                    .transition()
                    .duration(200)
                    .attr("transform", d => `translate(${d.x}, ${d.y}) scale(0)`)
                    .remove()
            )
            .attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : `node-${d.type}`}`)
            .each(function(d) {
                const selection = d3.select(this);
                const textElement = selection.select("text");
                
                if (d.isCentral) {
                    textElement.attr("class", "node-text").text(d.word || d.id).attr("dy", "0.3em");
                } else if (d.type === 'add') {
                    textElement.text('+').style("font-size", "24px").style("fill", "white");
                } else if (textBoxTypes.includes(d.type)) {
                    selection.select("rect").attr("class", "example-bg");
                    let fullText = d.text;
                    if (d.explanation) fullText += `\n(${d.explanation})`;
                    if (d.type === 'meaning' && d.examples) fullText += d.examples.map(ex => `\n  •  ${ex}`).join('');
                    
                    createInteractiveText(textElement, fullText, (word) => handleWordSubmitted(word, true, d));
                    
                    // Enhanced text box sizing and positioning
                    setTimeout(() => {
                        const bbox = textElement.node()?.getBBox();
                        if (bbox && bbox.width > 0) {
                            d.width = Math.max(bbox.width + 20, 120); // Minimum width
                            d.height = Math.max(bbox.height + 10, 40); // Minimum height
                            
                            selection.select("rect")
                                .attr("width", d.width)
                                .attr("height", d.height)
                                .attr("x", bbox.x - 10)
                                .attr("y", bbox.y - 5)
                                .attr("rx", 8) // Rounded corners
                                .transition()
                                .duration(200)
                                .style("opacity", 1);
                            
                            // Restart simulation with lower alpha for smoother repositioning
                            simulation.alpha(0.05).restart();
                        }
                    }, 0);
                } else {
                    textElement.text(d.text || d.id).attr("dy", -22);
                }
            });

        simulation.nodes(visibleNodes);
        simulation.force("link").links(visibleLinks);
        simulation.force("center").x(width / 2).y(height / 2);
        
        // Update radial force center to active central node
        if (currentActiveCentral) {
            const activeCentral = visibleNodes.find(n => n.isCentral && n.clusterId === currentActiveCentral);
            if (activeCentral) {
                simulation.force("radial")
                    .x(activeCentral.x)
                    .y(activeCentral.y);
            }
        }
        
        // Gentle restart to avoid jarring movements
        simulation.alpha(0.3).restart();
        graphGroup.selectAll('.central-node').raise();
        updateCentralNodeState();
    }

    // Enhanced tick function with smoother animations
    simulation.on("tick", () => {
        graphGroup.selectAll('.link')
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        
        graphGroup.selectAll('.node')
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });


    async function toggleExampleForNode(nodeData) {
        const cluster = graphClusters.get(nodeData.clusterId);
        if (!cluster) return;
        const existingExample = cluster.nodes.find(n => n.sourceNodeId === nodeData.id);
        if (existingExample) {
            cluster.nodes = cluster.nodes.filter(n => n.id !== existingExample.id);
            cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== existingExample.id);
        } else {
            try {
                const data = await fetchData(nodeData.text, 'generateExample');
                if (data && data.example) {
                    const exId = `${nodeData.id}-ex`;
                    const exNode = { 
                        id: exId, 
                        text: data.example, 
                        type: 'example', 
                        sourceNodeId: nodeData.id, 
                        clusterId: nodeData.clusterId, 
                        visible: true 
                    };
                    
                    // Position near source node
                    if (nodeData.x && nodeData.y) {
                        const angle = Math.random() * Math.PI * 2;
                        exNode.x = nodeData.x + Math.cos(angle) * 100;
                        exNode.y = nodeData.y + Math.sin(angle) * 100;
                    }
                    
                    cluster.nodes.push(exNode);
                    cluster.links.push({ source: nodeData.id, target: exId, type: 'example' });
                }
            } catch (error) {
                console.error("Error getting example:", error);
            }
        }
        updateGraph();
    }

    async function handleWordSubmitted(word, isNewCentral = true, sourceNode = null) {
        const lowerWord = word.toLowerCase();
        if (isNewCentral) {
            if (centralNodes.some(c => c.word === lowerWord)) return focusOnCentralNode(lowerWord);
            
            const newCenter = findOptimalCentralPosition(sourceNode);
            const centralNodeData = { 
                word: lowerWord, 
                id: `central-${lowerWord}`, 
                isCentral: true, 
                type: 'central', 
                clusterId: lowerWord, 
                x: newCenter.x, 
                y: newCenter.y, 
                fx: newCenter.x, 
                fy: newCenter.y, 
                visible: true 
            };
            
            // Release fixed position after settling
            setTimeout(() => { 
                centralNodeData.fx = null; 
                centralNodeData.fy = null; 
            }, 2000);
            
            centralNodes.push(centralNodeData);
            graphClusters.set(lowerWord, { 
                nodes: [centralNodeData], 
                links: [], 
                center: newCenter, 
                currentView: 'meaning' 
            });
            
            // Smooth pan to new node
            setTimeout(() => panToNode(centralNodeData, 1.0), 100);
        }
        
        currentActiveCentral = lowerWord;
        currentView = 'meaning';
        viewState = { offset: 0, hasMore: true };
        updateActiveButton();
        await generateGraphForView(currentView);
    }

   async function generateGraphForView(view, options = {}) {
        if (!currentActiveCentral) return;
        const cluster = graphClusters.get(currentActiveCentral);
        if (!cluster) return;

        // Force refetch if requested
        if (options.forceRefetch) {
            cluster.nodes = cluster.nodes.filter(n => n.type !== view);
        }
        
        const alreadyLoaded = cluster.nodes.some(n => n.type === view);
        cluster.currentView = view;
        currentView = view;
        updateActiveButton();

        if (alreadyLoaded) {
            console.log(`CACHE HIT for "${currentActiveCentral}" - view: ${view}`);
            cluster.nodes.forEach(node => { 
                node.visible = node.isCentral || node.type === 'add' || node.type === view; 
            });
            updateGraph();
            return;
        }

        console.log(`CACHE MISS for "${currentActiveCentral}" - view: ${view}. Fetching...`);
        renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);

        try {
            const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, options.language);
            if (!data || !data.nodes) throw new Error("No data received");

            // Hide other view nodes
            cluster.nodes.forEach(node => { 
                if (!node.isCentral && node.type !== 'add') node.visible = false; 
            });
            
            const newNodes = [];
            data.nodes.forEach(nodeData => {
                const nodeId = `${currentActiveCentral}-${nodeData.text.slice(0, 10)}-${view}`;
                if (!cluster.nodes.some(n => n.id === nodeId)) {
                    const newNode = { 
                        ...nodeData, 
                        id: nodeId, 
                        type: view, 
                        clusterId: currentActiveCentral, 
                        visible: true 
                    };
                    newNodes.push(newNode);
                    cluster.nodes.push(newNode);
                    cluster.links.push({ source: `central-${currentActiveCentral}`, target: nodeId });
                }
            });
            
            // Position new nodes optimally
            positionNewNodes(cluster, newNodes);
            
            // Add/show the "add more" node
            const addNodeId = `add-${currentActiveCentral}`;
            if (!cluster.nodes.some(n => n.id === addNodeId)) {
                const centralNode = cluster.nodes.find(n => n.isCentral);
                const addNode = { 
                    id: addNodeId, 
                    type: 'add', 
                    clusterId: currentActiveCentral, 
                    visible: true,
                    x: centralNode.x + NODE_SPACING,
                    y: centralNode.y + NODE_SPACING
                };
                cluster.nodes.push(addNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: addNodeId });
            } else {
                cluster.nodes.find(n => n.id === addNodeId).visible = true;
            }
            
            detectCrossConnections();
            updateGraph();
        } catch (error) {
            renderError(`Error loading ${view}: ${error.message}`);
        }
    }

function panToNode(node, scale = 1.2) {
        if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return;
        
        const { width, height } = graphContainer.getBoundingClientRect();
        const currentTransform = d3.zoomTransform(svg.node());
        
        // Calculate target transform
        const targetX = width / 2 - node.x * scale;
        const targetY = height / 2 - node.y * scale;
        
        // Smooth transition
        svg.transition()
            .duration(750)
            .ease(d3.easeCubicInOut)
            .call(zoomBehavior.transform, d3.zoomIdentity.translate(targetX, targetY).scale(scale));
    }
    
function detectCrossConnections() {
        crossConnections = [];
        const allNodes = [];
        for (const cluster of graphClusters.values()) {
            allNodes.push(...cluster.nodes.filter(n => n.visible !== false && !n.isCentral));
        }
        
        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const nodeA = allNodes[i];
                const nodeB = allNodes[j];
                if (nodeA.clusterId !== nodeB.clusterId && 
                    nodeA.text && nodeB.text && 
                    nodeA.text.toLowerCase() === nodeB.text.toLowerCase()) {
                    crossConnections.push({
                        source: nodeA.id,
                        target: nodeB.id,
                        type: 'cross-connection'
                    });
                }
            }
        }
    }

    function promptForInitialWord() { /* ... unchanged ... */ }
    function panToNode(node, scale = 1.2) { /* ... unchanged ... */ }
    function detectCrossConnections() { /* ... unchanged ... */ }
    function handleDockClick(event) { /* ... unchanged ... */ }
    function handleZoomControlsClick(event) { /* ... unchanged ... */ }

    function handleRegisterToggle() {
        currentRegister = (currentRegister === 'conversational') ? 'academic' : 'conversational';
        registerToggleBtn.classList.toggle('is-academic', currentRegister === 'academic');
        if (currentActiveCentral) {
            console.log(`Register changed to '${currentRegister}'. Re-fetching for '${currentActiveCentral}'.`);
            // ⭐ FIX: Force a re-fetch to get data for the new register.
            generateGraphForView(currentView, { forceRefetch: true });
        }
    }

    function focusOnCentralNode(clusterId) {
        const centralNode = centralNodes.find(n => n.word === clusterId);
        if (centralNode) {
            currentActiveCentral = clusterId;
            currentView = graphClusters.get(clusterId)?.currentView || 'meaning';
            updateActiveButton();
            panToNode(centralNode);
            updateCentralNodeState();
        }
    }

    function handleNodeClick(event, d) {
        // ⭐ FIX: This check correctly prevents click from firing after drag.
        if (event.defaultPrevented) return;
        event.stopPropagation();
        const exampleTypes = ['synonyms', 'opposites', 'derivatives', 'collocations', 'idioms', 'context'];
        if (exampleTypes.includes(d.type)) return toggleExampleForNode(d);
        if (d.isCentral) focusOnCentralNode(d.clusterId);
        else if (d.type === 'add') fetchMoreNodes();
        else if (d.type === 'translation') toggleTranslationExamples(d);
    }
    
    function createInteractiveText(d3TextElement, text, onWordClick) { /* ... unchanged ... */ }
    function handleMouseOver(event, d) { /* ... unchanged ... */ }
    function handleMouseOut(event) { /* ... unchanged ... */ }
    function handleResize() { /* ... unchanged ... */ }

    async function toggleTranslationExamples(translationNode) {
        const cluster = graphClusters.get(translationNode.clusterId);
        if (!cluster) return;
        const examplesShown = cluster.nodes.some(n => n.sourceNodeId === translationNode.id);
        if (examplesShown) {
            cluster.nodes = cluster.nodes.filter(n => n.sourceNodeId !== translationNode.id);
        } else if (translationNode.exampleTranslations) {
            for (const [eng, trans] of Object.entries(translationNode.exampleTranslations)) {
                const langTrans = trans[translationNode.lang] || "N/A";
                const exId = `${translationNode.id}-ex-${eng.slice(0, 5)}`;
                // ⭐ FIX: Ensure new node is marked as visible
                const exNode = { id: exId, text: `${eng}\n${langTrans}`, type: 'example', sourceNodeId: translationNode.id, clusterId: translationNode.clusterId, visible: true };
                cluster.nodes.push(exNode);
                cluster.links.push({ source: translationNode.id, target: exId });
            }
        }
        updateGraph();
    }

    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveCentral);
        if (!cluster || !viewState.hasMore) return;
        try {
            const data = await fetchData(currentActiveCentral, cluster.currentView, viewState.offset, 3);
            if (data.nodes.length > 0) {
                data.nodes.forEach(newNodeData => {
                    const newNodeId = `${currentActiveCentral}-${newNodeData.text.slice(0,10)}-${cluster.currentView}`;
                    if (!cluster.nodes.some(n => n.id === newNodeId)) {
                        // ⭐ FIX: Ensure new node is marked as visible
                        const newNode = { ...newNodeData, id: newNodeId, type: cluster.currentView, clusterId: currentActiveCentral, visible: true };
                        cluster.nodes.push(newNode);
                        cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNodeId });
                    }
                });
                viewState.offset += data.nodes.length;
                viewState.hasMore = data.hasMore;
                updateGraph();
            } else {
                viewState.hasMore = false;
            }
        } catch (error) {
            console.error("Failed to fetch more nodes:", error);
        }
    }
    
    function updateCentralNodeState() { /* ... unchanged ... */ }
    function updateActiveButton() { /* ... unchanged ... */ }
    function toggleTheme() { /* ... unchanged ... */ }
    function toggleFullScreen() { /* ... unchanged ... */ }
    function saveAsPng() { /* ... unchanged ... */ }
    function dragstarted(event, d) { /* ... unchanged ... */ }
    function dragged(event, d) { /* ... unchanged ... */ }
    function dragended(event, d) { /* ... unchanged ... */ }

    // --- Initialization ---
    renderInitialPrompt();
    controlsDock.addEventListener('click', handleDockClick);
    zoomControls.addEventListener('click', handleZoomControlsClick);
    registerToggleBtn.addEventListener('click', handleRegisterToggle);
    window.addEventListener('resize', handleResize);
    modalCloseBtn.addEventListener('click', () => languageModal.classList.remove('visible'));
    languageModal.addEventListener('click', (event) => { if (event.target === languageModal) languageModal.classList.remove('visible'); });
    languageList.addEventListener('click', (event) => {
        if (event.target.tagName === 'LI') {
            languageModal.classList.remove('visible');
            generateGraphForView('translation', { language: event.target.dataset.lang, forceRefetch: true });
        }
    });
});