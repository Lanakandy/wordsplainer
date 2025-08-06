// --- START OF FILE script.js ---

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// Immediately check for and apply the saved theme
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

    if (registerToggleBtn) {
        registerToggleBtn.classList.add('needs-attention');
    }

    if (registerToggleBtn) {
        registerToggleBtn.addEventListener('click', () => {
            registerToggleBtn.classList.toggle('is-academic');

            const isAcademic = registerToggleBtn.classList.contains('is-academic');

            console.log('Register is now:', isAcademic ? 'Academic' : 'Conversational');

            });
    }

    const tooltip = document.getElementById('graph-tooltip');
    const svg = d3.select("#wordsplainer-graph-svg");
    const graphGroup = svg.append("g");
    const SNAP_OFF_THRESHOLD = 120;

    // --- Enhanced State Management ---
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let explorationHistory = [];
    let currentActiveCentral = null;
    let clusterColors = d3.scaleOrdinal(d3.schemeCategory10);

    let currentView = 'meaning';
    let currentRegister = 'conversational';
    let viewState = { offset: 0, hasMore: true };

   function stopRegisterButtonAnimation() {
        if (registerToggleBtn) {
            registerToggleBtn.classList.remove('needs-attention');
        }
    }

    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
    try {
        console.log(`Fetching data: ${word}, ${type}, register: ${currentRegister}`);

        const response = await fetch('/.netlify/functions/wordsplainer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word: word,
                type: type,
                offset: offset,
                limit: limit,
                language: language,
                register: currentRegister
            }),
        });

        if (!response.ok) {
            let errorMessage;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || `Server error: ${response.status}`;
            } catch (jsonError) {
                // If we can't parse the error response as JSON, get the text
                const errorText = await response.text();
                errorMessage = errorText || `HTTP ${response.status} error`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log("Received data:", data);
        return data;

    } catch (error) {
        console.error("fetchData error:", error);
        // Re-throw with more context
        throw new Error(`Failed to fetch ${type} for "${word}": ${error.message}`);
    }
}

    function forceCluster() {
    let strength = 0.15;
    return function(alpha) {
        const allNodes = getConsolidatedGraphData().nodes;

        for (let node of allNodes) {
            if (node.clusterId && graphClusters.has(node.clusterId)) {
                const cluster = graphClusters.get(node.clusterId);
                const target = cluster.center;

                if (node.isCentral) {
                    // Central nodes stay at cluster center with strong force
                    const strengthFactor = 3.0;
                    node.vx += (target.x - node.x) * strength * alpha * strengthFactor;
                    node.vy += (target.y - node.y) * strength * alpha * strengthFactor;
                } else {
                    // Peripheral nodes arrange in concentric circles around center
                    const clusterNodes = cluster.nodes.filter(n => !n.isCentral && n.visible !== false);
                    const nodeIndex = clusterNodes.indexOf(node);
                    const totalNodes = clusterNodes.length;

                    if (totalNodes > 0) {
                        // Calculate ideal position in circular arrangement
                        const radius = Math.min(180 + (Math.floor(nodeIndex / 8) * 60), 300);
                        const angleStep = (2 * Math.PI) / Math.min(8, totalNodes);
                        const angle = (nodeIndex % 8) * angleStep + (Math.floor(nodeIndex / 8) * 0.5);

                        const idealX = target.x + Math.cos(angle) * radius;
                        const idealY = target.y + Math.sin(angle) * radius;

                        const strengthFactor = 0.4;
                        node.vx += (idealX - node.x) * strength * alpha * strengthFactor;
                        node.vy += (idealY - node.y) * strength * alpha * strengthFactor;
                    }
                }
            }
        }
    };
}

function getCollisionRadius(d) {
    if (d.isCentral) {
        return 50; // Larger buffer for central nodes
    }
    if (d.type === 'example') {
        // Dynamic radius based on text content
        if (d.width && d.height) {
            return Math.sqrt(d.width * d.width + d.height * d.height) / 2 + 15;
        }
        return 60; // Default for examples
    }
    if (d.type === 'add') {
        return 25;
    }
    // Regular peripheral nodes
    return 30;
}

    const Simulation = d3.forceSimulation()
    .force("link", d3.forceLink()
        .id(d => d.id)
        .distance(d => {
            if (d.type === 'cross-cluster') return 250;
            if (d.target.type === 'example') return 120;
            if (d.source.isCentral) return 160;
            return 100;
        })
        .strength(d => {
            if (d.type === 'cross-cluster') return 0.3;
            if (d.target.type === 'example') return 0.8;
            return 0.6;
        })
    )
    .force("charge", d3.forceManyBody()
        .strength(d => {
            if (d.isCentral) return -800;
            if (d.type === 'example') return -300;
            return -200;
        })
        .distanceMax(400)
    )
    .force("collision", d3.forceCollide()
        .radius(getCollisionRadius)
        .strength(0.8)
        .iterations(3)
    )
    .force("cluster", forceCluster())
    .force("center", d3.forceCenter())
    .force("boundary", () => {
        // Keep nodes within viewport boundaries
        const { width, height } = graphContainer.getBoundingClientRect();
        const margin = 100;

        const allNodes = getConsolidatedGraphData().nodes;
        allNodes.forEach(node => {
            if (node.x < margin) node.x = margin;
            if (node.x > width - margin) node.x = width - margin;
            if (node.y < margin) node.y = margin;
            if (node.y > height - margin) node.y = height - margin;
        });
    });
function positionNewCluster(sourceNode) {
    const { width, height } = graphContainer.getBoundingClientRect();
    const existingCenters = Array.from(graphClusters.values()).map(c => c.center);

    let attempts = 0;
    let newCenter;
    const minDistance = 400; // Minimum distance between cluster centers

    do {
        if (sourceNode && typeof sourceNode.x === 'number') {
            // Position relative to source node with some randomization
            const angle = (attempts * 60) * (Math.PI / 180); // Try different angles
            const distance = 450 + (attempts * 50);
            newCenter = {
                x: sourceNode.x + Math.cos(angle) * distance,
                y: sourceNode.y + Math.sin(angle) * distance
            };
        } else {
            // Random positioning with bias toward center
            const centerBias = 0.3;
            newCenter = {
                x: width * (centerBias + Math.random() * (1 - 2 * centerBias)),
                y: height * (centerBias + Math.random() * (1 - 2 * centerBias))
            };
        }

        // Check distance from existing clusters
        const tooClose = existingCenters.some(center => {
            const distance = Math.sqrt(
                Math.pow(newCenter.x - center.x, 2) +
                Math.pow(newCenter.y - center.y, 2)
            );
            return distance < minDistance;
        });

        if (!tooClose) break;
        attempts++;

    } while (attempts < 8);

    // Ensure within bounds
    newCenter.x = Math.max(150, Math.min(width - 150, newCenter.x));
    newCenter.y = Math.max(150, Math.min(height - 150, newCenter.y));

    return newCenter;
}

    const zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on("zoom", (event) => {
        graphGroup.attr("transform", event.transform);
    });
    svg.call(zoomBehavior);

    function renderInitialPrompt() {
        Simulation.stop(); // FIX: Renamed from simulation to Simulation for consistency
        centralNodes = [];
        graphClusters.clear();
        crossConnections = [];
        currentActiveCentral = null;
        graphGroup.selectAll("*").remove();

        const { width, height } = graphContainer.getBoundingClientRect();
        const promptGroup = graphGroup.append("g")
            .attr("class", "node central-node")
            .style("cursor", "pointer")
            .on("click", promptForInitialWord);
        promptGroup.append("circle").attr("cx", width / 2).attr("cy", height / 2).attr("r", 40);
        promptGroup.append("text").attr("class", "sub-text").attr("x", width / 2).attr("y", height / 2).attr("dy", "0.1em").text("+");
        promptGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 70).text("Add a word to explore");
    }

    function renderLoading(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();

        const loadingGroup = graphGroup.append("g");
        loadingGroup.append("circle").attr("class", "loading-spinner").attr("cx", width / 2).attr("cy", height / 2 - 30).attr("r", 20).attr("fill", "none").attr("stroke", "var(--primary-coral)").attr("stroke-width", 3).attr("stroke-dasharray", "31.4, 31.4");
        loadingGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 30).text(message);
    }

    function renderError(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();
        graphGroup.append("text").attr("class", "status-text error-text").attr("x", width / 2).attr("y", height / 2).text(message);
    }

    function getConsolidatedGraphData() {
        let nodes = [];
        let links = [];
        for (const cluster of graphClusters.values()) {
            nodes.push(...cluster.nodes);
            links.push(...cluster.links);
        }
        return { nodes, links: [...links, ...crossConnections] };
    }

function updateGraph() {
    // FIX 2: Define visibleNodes and visibleLinks before using them.
    // First, get all data, then filter it based on the 'visible' property.
    const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();
    const visibleNodes = allNodes.filter(n => n.visible !== false);
    const visibleLinks = allLinks.filter(l =>
        (l.source.visible !== false) && (l.target.visible !== false)
    );
    const { width, height } = graphContainer.getBoundingClientRect();
    const textBoxTypes = ['example', 'meaning', 'context'];


    const nodeGroups = graphGroup.selectAll(".node")
        .data(visibleNodes, d => d.id)
        .join(
            enter => {
                const nodeGroup = enter.append("g")
                    .attr("class", d => `node ${d.isCentral ? 'central-node' : `node-${d.type}`}`)
                    .style("opacity", 0)
                    .attr("transform", d => {
                        // Start nodes at their cluster center for smooth animation
                        const cluster = graphClusters.get(d.clusterId);
                        const startPos = cluster ? cluster.center : { x: width/2, y: height/2 };
                        return `translate(${startPos.x},${startPos.y}) scale(0.1)`;
                    })
                    .call(d3.drag()
                        .on("start", dragstarted)
                        .on("drag", dragged)
                        .on("end", dragended)
                        .filter(event => !event.target.classList.contains('interactive-word'))
                    )
                    .on("mouseover", handleMouseOver)
                    .on("mouseout", handleMouseOut)
                    .on("click", handleNodeClick);

                // Add shape based on node type
                nodeGroup.append(d =>
                    textBoxTypes.includes(d.type) ?
                    document.createElementNS(d3.namespaces.svg, 'rect') :
                    document.createElementNS(d3.namespaces.svg, 'circle')
                );

                // Add text element
                nodeGroup.append("text");

                // Animate node entrance with staggered timing
                nodeGroup.transition()
                    .duration(600)
                    .delay((d, i) => {
                        if (d.isCentral) return 0;
                        if (d.type === 'add') return visibleNodes.length * 30;
                        return i * 80;
                    })
                    .ease(d3.easeBackOut.overshoot(1.2))
                    .style("opacity", 1)
                    .attr("transform", d => `translate(${d.x || 0},${d.y || 0}) scale(1)`);

                return nodeGroup;
            },
            update => update
                .transition()
                .duration(300)
                .attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : `node-${d.type}`}`),
            exit => exit.transition()
                .duration(400)
                .ease(d3.easeCircleIn)
                .attr("transform", d => `translate(${d.x},${d.y}) scale(0)`)
                .style("opacity", 0)
                .remove()
        );

    // Enhanced node content rendering
    nodeGroups.each(function(d) {
        const selection = d3.select(this);
        const textElement = selection.select("text");

        if (d.isCentral) {
            // Central node styling with glow effect
            selection.select("circle")
                .attr("r", 45)
                .style("filter", "drop-shadow(0 0 10px var(--primary-coral))");

            textElement
                .attr("class", "node-text")
                .text(d.word || d.id)
                .attr("dy", "0.3em")
                .style("font-weight", "bold")
                .style("font-size", "16px");

        } else if (d.type === 'add') {
            selection.select("circle")
                .attr("r", 20)
                .style("transition", "all 0.3s ease");

            textElement
                .text('+')
                .style("font-size", "20px")
                .style("font-weight", "300")
                .style("fill", "white")
                .attr("dy", "0.3em");

        } else if (textBoxTypes.includes(d.type)) {
            // Example boxes with enhanced styling
            selection.select("rect")
                .attr("class", "example-bg")
                .style("rx", "8")
                .style("ry", "8")
                .style("filter", "drop-shadow(0 2px 8px rgba(0,0,0,0.1))");

            let fullText = d.text;
            if (d.explanation) {
                fullText += `\n(${d.explanation})`;
            }

            if (d.type === 'meaning' && d.examples && d.examples.length > 0) {
                const exampleLines = d.examples.map(ex => `\n  •  ${ex}`).join('');
                fullText += exampleLines;
            }

                createInteractiveText(textElement, fullText, (word) => handleWordSubmitted(word, true, d));

                setTimeout(() => {
                const bbox = textElement.node()?.getBBox();
                if (bbox && bbox.width > 0) {
                    const padding = { x: 24, y: 14 };
                    d.width = bbox.width + padding.x;
                    d.height = bbox.height + padding.y;

                    selection.select("rect")
                        .attr("width", 0)
                        .attr("height", 0)
                        .attr("x", bbox.x)
                        .attr("y", bbox.y)
                        .transition()
                        .duration(400)
                        .ease(d3.easeBackOut.overshoot(1.1))
                        .attr("width", d.width)
                        .attr("height", d.height)
                        .attr("x", bbox.x - (padding.x / 2))
                        .attr("y", bbox.y - (padding.y / 2))
                        .style("opacity", 1);

                    Simulation.alpha(0.2).restart();
                }
            }, 100);

        } else {
            // Regular peripheral nodes
            selection.select("circle")
                .attr("r", 18)
                .style("transition", "all 0.2s ease");

            textElement
                .text(d.text || d.id)
                .attr("dy", "0.3em")
                .style("font-size", "12px");
        }
    });

    graphGroup.selectAll(".link")
        .data(visibleLinks, d => `${d.source.id}-${d.target.id}`) // FIX: Bind data to links as well
        .join("line") // FIX: Use join pattern for links too
        .attr("class", "link")
        .style("stroke", d => {
            if (d.type === 'cross-cluster') return 'var(--accent-orange)';
            if (d.target.type === 'example') return 'var(--primary-coral)';
            return 'var(--text-secondary)';
        })
        .style("stroke-width", d => {
            if (d.type === 'cross-cluster') return 2;
            if (d.target.type === 'example') return 1.5;
            return 1;
        })
        .style("stroke-dasharray", d => d.type === 'cross-cluster' ? "8,4" : "none")
        .style("opacity", d => d.target.type === 'example' ? 0.8 : 0.6);

    // Update simulation
    Simulation.nodes(visibleNodes);
    Simulation.force("link").links(visibleLinks);
    Simulation.force("center").x(width / 2).y(height / 2);
    Simulation.alpha(1).restart();

    // Ensure central nodes are always on top
    graphGroup.selectAll('.central-node').raise();

    updateCentralNodeState();
}

    Simulation.on("tick", () => { // FIX: Renamed from simulation to Simulation for consistency
        graphGroup.selectAll('.link').attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
    });

function panToNodeEnhanced(node, scale = 1.2) {
    if (!node) return;
    const { width, height } = graphContainer.getBoundingClientRect();
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-node.x, -node.y);
    
    svg.transition()
        .duration(1000) // Longer duration for a smoother feel
        .ease(d3.easeCubicInOut) // Smoother easing
        .call(zoomBehavior.transform, transform);
}

    function detectCrossConnections() {
        crossConnections = [];
        const allPeripheralNodes = [];
        graphClusters.forEach(cluster => {
            allPeripheralNodes.push(...cluster.nodes.filter(n => !n.isCentral && n.text));
        });
        for (let i = 0; i < allPeripheralNodes.length; i++) {
            for (let j = i + 1; j < allPeripheralNodes.length; j++) {
                const node1 = allPeripheralNodes[i], node2 = allPeripheralNodes[j];
                if (node1.clusterId !== node2.clusterId && node1.text.toLowerCase() === node2.text.toLowerCase()) {
                    crossConnections.push({ source: node1.id, target: node2.id, type: 'cross-cluster' });
                }
            }
        }
    }

async function toggleExampleForNode(nodeData) {
    const cluster = graphClusters.get(nodeData.clusterId);
    if (!cluster) return;

    const existingExample = cluster.nodes.find(n => n.sourceNodeId === nodeData.id);

    if (existingExample) {
        // This part for removing an example is unchanged
        cluster.nodes = cluster.nodes.filter(n => n.id !== existingExample.id);
        cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== existingExample.id);
        updateGraph();
    } else {
        try {
            // This function is a smart dispatcher.
            const requestBody = {
                type: 'generateExample',
                word: nodeData.text, // The word/phrase from the clicked node
                register: currentRegister,
                sourceNodeType: nodeData.type // e.g., 'meaning', 'idioms', 'translation'
            };

            // Add specific context based on the node type
            if (nodeData.type === 'meaning' || nodeData.type === 'context' || nodeData.type === 'translation') {
                requestBody.centralWord = nodeData.clusterId;
            }
            if (nodeData.type === 'meaning') {
                requestBody.definition = nodeData.text;
            }
            if (nodeData.type === 'context') {
                requestBody.context = nodeData.text;
            }
            if (nodeData.type === 'translation') {
                requestBody.translation = nodeData.text;
                requestBody.language = nodeData.lang; // Use the language code we stored
            }

            const response = await fetch('/.netlify/functions/wordsplainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
                throw new Error(errorData.error || 'Server returned an error.');
            }

            const data = await response.json();

            let exampleText = null;

            // Handle the different possible response shapes
            if (data.english_example && data.translated_example) {
                // Bilingual example for translations
                exampleText = `${data.english_example}\n${data.translated_example}`;
            } else if (data.example) {
                // Standard example (for meaning, context, idioms, etc.)
                exampleText = data.example;
                if (data.explanation) {
                    // Append explanation if it exists (for idioms)
                    exampleText += `\n\n(${data.explanation})`;
                }
            }

            if (exampleText) {
                const exId = `${nodeData.id}-ex`;
                const exNode = {
                    id: exId,
                    text: exampleText,
                    type: 'example',
                    sourceNodeId: nodeData.id,
                    clusterId: nodeData.clusterId,
                    visible: true // Ensure example node is visible
                };
                cluster.nodes.push(exNode);
                cluster.links.push({ source: nodeData.id, target: exId, type: 'example' });
                updateGraph();
            } else {
                throw new Error('No valid example received from server');
            }
        } catch (error) {
            console.error("Error getting example:", error);
            alert(`Sorry, we couldn't generate an example. Reason: ${error.message}`);
        }
    }
}

async function handleWordSubmitted(word, isNewCentral = true, sourceNode = null) {
    const lowerWord = word.toLowerCase();

    if (isNewCentral) {
        if (centralNodes.some(c => c.word === lowerWord)) {
            focusOnCentralNode(lowerWord);
            return;
        }

        // Use enhanced cluster positioning
        const newCenter = positionNewCluster(sourceNode);

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

        // Release fixed position with delay
        setTimeout(() => {
            if (centralNodeData) {
                centralNodeData.fx = null;
                centralNodeData.fy = null;
                // FIX 1: The simulation variable is `Simulation`, not `enhancedSimulation`.
                Simulation.alpha(0.3).restart();
            }
        }, 2000);

        centralNodes.push(centralNodeData);
        graphClusters.set(lowerWord, {
            nodes: [centralNodeData],
            links: [],
            center: newCenter,
            currentView: 'meaning'
        });

        panToNodeEnhanced(centralNodeData, 1.3);
    }

    currentActiveCentral = lowerWord;
    currentView = 'meaning';
    viewState = { offset: 0, hasMore: true };
    updateActiveButton();
    await generateGraphForView(currentView);
}

       async function generateGraphForView(view, options = {}) {
    if (!currentActiveCentral) return renderError('No word selected.');

    const cluster = graphClusters.get(currentActiveCentral);
    if (!cluster) return renderError('Invalid word cluster.');

    // Hide nodes from other views before proceeding
    cluster.nodes.forEach(node => {
        if (!node.isCentral && node.type !== 'add') {
             // A node is visible only if it belongs to the NEW view being requested
            node.visible = (node.type === view);
        }
    });

    // --- CACHE CHECK ---
    const alreadyLoaded = cluster.nodes.some(n => n.type === view);
    if (alreadyLoaded) {
        console.log(`CACHE HIT for "${currentActiveCentral}" - view: ${view}`);
        cluster.currentView = view;
        currentView = view; // Keep global view in sync
        updateActiveButton();
        updateGraph(); // Re-render with the new visibility settings
        return;
    }


    // --- CACHE MISS ---
    console.log(`CACHE MISS for "${currentActiveCentral}" - view: ${view}. Fetching...`);
    cluster.currentView = view;
    currentView = view;
    updateActiveButton();
    renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);

    try {
        const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, options.language);
        if (!data || !data.nodes) throw new Error("No data received from server.");

        // Add new nodes from the fetch
         data.nodes.forEach(nodeData => {
            if (!nodeData || typeof nodeData.text !== 'string') return;
            const nodeId = `${currentActiveCentral}-${nodeData.text.slice(0, 10)}-${view}`;
            if (cluster.nodes.some(n => n.id === nodeId)) return;

            const newNode = {
                ...nodeData,
                id: nodeId,
                type: view,
                clusterId: currentActiveCentral,
                visible: true,
                lang: options.language
            };
            cluster.nodes.push(newNode);
            cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNode.id });
        });

        const addNodeId = `add-${currentActiveCentral}`;
        let addNode = cluster.nodes.find(n => n.id === addNodeId);
        if (!addNode) {
            addNode = { id: addNodeId, type: 'add', clusterId: currentActiveCentral, visible: true };
            cluster.nodes.push(addNode);
            cluster.links.push({ source: `central-${currentActiveCentral}`, target: addNode.id });
        }
        addNode.visible = true;

        detectCrossConnections();
        updateGraph();

    } catch (error) {
        console.error("Error generating graph:", error);
        renderError(`Error loading ${view}: ${error.message}`);
    }
}

    function promptForInitialWord() {
    const inputOverlay = document.getElementById('input-overlay');
    const overlayInput = document.getElementById('overlay-input');

    overlayInput.placeholder = "Type a word and press Enter...";
    inputOverlay.classList.add('visible');
    overlayInput.focus();
    overlayInput.value = '';

    const handleKeyDown = (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            const value = overlayInput.value.trim();
            if (value) {
                handleWordSubmitted(value, true);
            }
            // Cleanup listeners when done
            inputOverlay.classList.remove('visible');
            overlayInput.removeEventListener('keydown', handleKeyDown);
            overlayInput.removeEventListener('blur', handleBlur);
        }
    };

    const handleBlur = () => {
        // Cleanup listeners when done
        inputOverlay.classList.remove('visible');
        overlayInput.removeEventListener('keydown', handleKeyDown);
        overlayInput.removeEventListener('blur', handleBlur);
    };

    overlayInput.addEventListener('keydown', handleKeyDown);
    overlayInput.addEventListener('blur', handleBlur);
}

    function handleDockClick(event) {
        const button = event.target.closest('button');
        if (!button) return;
        const dataType = button.dataset.type;
        if (dataType) {
            if (!currentActiveCentral) return alert("Please add a word first by clicking the '+' icon.");
            if (dataType === 'translation') return languageModal.classList.add('visible');
            if (graphClusters.get(currentActiveCentral).currentView !== dataType) generateGraphForView(dataType);
        } else {
            switch (button.id) {
                case 'clear-btn': renderInitialPrompt(); break;
                case 'save-btn': saveAsPng(); break;
                case 'fullscreen-btn': toggleFullScreen(); break;
                case 'theme-toggle-btn': toggleTheme(); break;
            }
        }
    }

    function handleZoomControlsClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        switch (button.id) {
            case 'zoom-in-btn':
                svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.2);
                break;
            case 'zoom-out-btn':
                svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.8);
                break;
        }
    }

    function handleRegisterToggle() {
        stopRegisterButtonAnimation();
        currentRegister = (currentRegister === 'conversational') ? 'academic' : 'conversational';
        registerToggleBtn.classList.toggle('is-academic', currentRegister === 'academic');

        if (currentActiveCentral) {
            console.log(`Register changed to '${currentRegister}'. Re-fetching for '${currentActiveCentral}'.`);
            const cluster = graphClusters.get(currentActiveCentral);
            if (cluster) {
                // Clear all peripheral nodes and links to force a refetch
                cluster.nodes = cluster.nodes.filter(n => n.isCentral);
                cluster.links = [];
            }
            generateGraphForView(currentView);
        }
    }

    function focusOnCentralNode(clusterId) {
    const centralNode = centralNodes.find(n => n.word === clusterId || n.clusterId === clusterId);
    if (centralNode) {
        currentActiveCentral = clusterId;
        const cluster = graphClusters.get(clusterId);
        if (cluster) {
            currentView = cluster.currentView || 'meaning';
            updateActiveButton();
        }
        // FIX 4: Use the enhanced panning function for consistency
        panToNodeEnhanced(centralNode, 1.2);
        updateCentralNodeState();
        console.log(`Focused on central node: ${clusterId}`);
    }
}

    function handleNodeClick(event, d) {
    if (event.defaultPrevented) return;

    event.stopPropagation();

    // Visual feedback for click
    const selection = d3.select(event.currentTarget);
    selection.transition()
        .duration(150)
        .ease(d3.easeCircleOut)
        .attr("transform", `translate(${d.x},${d.y}) scale(0.9)`)
        .transition()
        .duration(150)
        .ease(d3.easeCircleOut)
        .attr("transform", `translate(${d.x},${d.y}) scale(1)`);

    // Handle the click based on node type
    const exampleTypes = ['synonyms', 'opposites', 'derivatives', 'collocations', 'idioms', 'context', 'meaning', 'translation'];

    if (exampleTypes.includes(d.type)) {
        toggleExampleForNode(d);
    } else if (d.isCentral) {
        focusOnCentralNode(d.clusterId);
    } else if (d.type === 'add') {
        fetchMoreNodes();
    }
}
/**
 * Renders text inside a D3 text element, making individual words interactive.
 * @param {d3.Selection} d3TextElement The D3 selection of the <text> element.
 * @param {string} text The full string to render.
 * @param {function(string): void} onWordClick The callback function to execute when a word is clicked.
 */

function createInteractiveText(d3TextElement, text, onWordClick) {
    d3TextElement.selectAll("tspan").remove(); // Clear previous content

    /// Split text into lines first
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
        // Split each line into words and punctuation, keeping the delimiters
        const tokens = line.split(/(\s+|[.,!?;:"])/g).filter(t => t);

        const lineTspan = d3TextElement.append('tspan')
            .attr('x', 0) // Centered by the parent text's text-anchor
            .attr('dy', lineIndex === 0 ? '0.3em' : '1.4em');

        tokens.forEach(token => {
            const cleanedToken = token.trim().toLowerCase();
            // Make it clickable only if it's a "notional" word (2+ letters, no numbers/symbols)
            if (cleanedToken.length > 1 && /^[a-z']+$/.test(cleanedToken)) {
                lineTspan.append('tspan')
                    .attr('class', 'interactive-word')
                    .text(token)
                    .on('click', (event) => {
                        event.stopPropagation(); // VERY IMPORTANT: Prevents the node's main click handler
                        // Get the raw text, remove punctuation for the API call
                        const wordToExplore = token.replace(/[.,!?;:"]+/g, '').trim();
                        if(wordToExplore) {
                           onWordClick(wordToExplore);
                        }
                    });
            } else {
                // Append non-clickable parts (spaces, punctuation, short words)
                lineTspan.append('tspan').text(token);
            }
        });
    });
}

    function handleMouseOver(event, d) {
     const selection = d3.select(event.currentTarget);

    // Smooth hover animation
    selection.transition()
        .duration(200)
        .ease(d3.easeCircleOut)
        .attr("transform", `translate(${d.x},${d.y}) scale(1.1)`);

    // Add glow effect
    if (d.isCentral) {
        selection.select("circle")
            .transition()
            .duration(200)
            .style("filter", "drop-shadow(0 0 20px var(--primary-coral))");
    } else if (d.type !== 'example') {
        selection.select("circle")
            .transition()
            .duration(200)
            .style("stroke", "var(--primary-coral)")
            .style("stroke-width", "2px");
    }

 let tooltipText = '';
    if (d.isCentral) {
        const cluster = graphClusters.get(d.clusterId);
        tooltipText = cluster ? `Exploring: ${cluster.currentView} • Click to focus` : '';
    } else if (d.type === 'add') {
        const cluster = graphClusters.get(d.clusterId);
        tooltipText = viewState.hasMore ?
            `Load more ${cluster?.currentView || 'items'}` :
            'No more items to load';
    } else if (d.text && !d.isCentral && d.type !== 'example') {
        tooltipText = `Click for examples • Drag to explore "${d.text}"`;
    }

    if (tooltipText) {
        tooltip.textContent = tooltipText;
        tooltip.classList.add('visible');
        tooltip.style.transform = 'translateY(-10px)';
    }

    svg.on('mousemove.tooltip', (e) => {
        tooltip.style.left = `${e.pageX + 15}px`;
        tooltip.style.top = `${e.pageY - 30}px`;
    });
}

    // FIX 3: The function signature must include `d` to access the node data.
    function handleMouseOut(event, d) {
       const selection = d3.select(event.currentTarget);

    // Smooth return animation
    selection.transition()
        .duration(200)
        .ease(d3.easeCircleOut)
        .attr("transform", `translate(${d.x},${d.y}) scale(1)`);

    // Remove glow effects
    if (d.isCentral) {
        selection.select("circle")
            .transition()
            .duration(200)
            .style("filter", "drop-shadow(0 0 10px var(--primary-coral))");
    } else if (d.type !== 'example') {
        selection.select("circle")
            .transition()
            .duration(200)
            .style("stroke", "none");
    }

    tooltip.classList.remove('visible');
    tooltip.style.transform = 'translateY(0)';
    svg.on('mousemove.tooltip', null);
}

    function handleResize() {
        const { width, height } = graphContainer.getBoundingClientRect();
        svg.attr("width", width).attr("height", height);

        if (centralNodes.length > 0) {
            Simulation.force("center").x(width / 2).y(height / 2);
            Simulation.alpha(0.3).restart();
        } else {
            renderInitialPrompt();
    }
}

    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveCentral);
        if (!currentActiveCentral || !cluster || !viewState.hasMore) return;

        const centralNodeElement = graphGroup.selectAll('.central-node').filter(d => d.clusterId === currentActiveCentral);
        centralNodeElement.classed('loading', true);

        try {
            const data = await fetchData(currentActiveCentral, cluster.currentView, viewState.offset, 3);

            if (data.nodes.length > 0) {
                data.nodes.forEach(newNodeData => {
                    if (!newNodeData || typeof newNodeData.text !== 'string') return;

                    const newNodeId = `${currentActiveCentral}-${newNodeData.text}-${cluster.currentView}`;
                    if (!cluster.nodes.some(n => n.id === newNodeId)) {
                        const newNode = { ...newNodeData, id: newNodeId, type: cluster.currentView, clusterId: currentActiveCentral, visible: true };
                        cluster.nodes.push(newNode);
                        cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNodeId });
                    }
                });
                viewState.offset += data.nodes.length;
                viewState.hasMore = data.hasMore;
                detectCrossConnections();
                updateGraph();
            } else {
                viewState.hasMore = false;
            }
        } catch (error) {
            console.error("Failed to fetch more nodes:", error);
            tooltip.textContent = "Error loading more.";
            tooltip.classList.add('visible');
            setTimeout(() => tooltip.classList.remove('visible'), 2000);
        } finally {
            centralNodeElement.classed('loading', false);
            updateCentralNodeState();
        }
    }

    function updateCentralNodeState() {
        if (!currentActiveCentral) return;
        const centralNodeElement = graphGroup.selectAll('.central-node').filter(d => d.clusterId === currentActiveCentral);
        if (centralNodeElement.empty()) return;
        const isPaginatedView = currentView !== 'meaning';
        centralNodeElement.classed('loadable', isPaginatedView && viewState.hasMore);
    }

    function updateActiveButton() {
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === currentView);
        });
    }

    function toggleTheme() {
        const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    }

    function toggleFullScreen() {
        if (!document.fullscreenElement) document.getElementById('app-wrapper').requestFullscreen().catch(err => alert(`Error: ${err.message}`));
        else document.exitFullscreen();
    }

    function saveAsPng() {
        if (centralNodes.length === 0) return alert("Nothing to save yet!");

        const svgEl = svg.node();
        const { width, height } = svgEl.getBoundingClientRect();

        const clonedSvg = svgEl.cloneNode(true);
        clonedSvg.setAttribute('width', width);
        clonedSvg.setAttribute('height', height);

        const rootStyles = getComputedStyle(document.documentElement);

        const originalElements = svgEl.querySelectorAll('circle, text, line, rect, tspan');
        const clonedElements = clonedSvg.querySelectorAll('circle, text, line, rect, tspan');

        originalElements.forEach((originalEl, i) => {
            if (i < clonedElements.length) {
                const clonedEl = clonedElements[i];
                const computedStyle = getComputedStyle(originalEl);

                const styleProps = [
                    'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
                    'font-size', 'font-family', 'font-weight', 'text-anchor',
                    'opacity', 'fill-opacity', 'stroke-opacity'
                ];

                styleProps.forEach(prop => {
                    const value = computedStyle.getPropertyValue(prop);
                    if (value && value !== 'none' && value !== '') {
                        clonedEl.setAttribute(prop, value);
                    }
                });
            }
        });

        const originalGroups = svgEl.querySelectorAll('g');
        const clonedGroups = clonedSvg.querySelectorAll('g');

        originalGroups.forEach((originalGroup, i) => {
            if (i < clonedGroups.length && originalGroup.className) {
                clonedGroups[i].setAttribute('class', originalGroup.className.baseVal || originalGroup.className);
            }
        });

        const svgString = new XMLSerializer().serializeToString(clonedSvg);
        const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        const image = new Image();

        image.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = 2;

            canvas.width = width * scale;
            canvas.height = height * scale;

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.scale(scale, scale);

            const bgColor = rootStyles.getPropertyValue('--canvas-bg')?.trim() ||
                           (rootStyles.getPropertyValue('--bg-primary')?.trim()) ||
                           '#ffffff';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);

            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Wordsplainer-${currentActiveCentral || 'graph'}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 'image/png', 1.0);
        };

        image.onerror = (e) => {
            console.error('Failed to load SVG:', e);
            alert('Failed to save image. Please try again.');
        };

        image.src = svgDataUrl;
    }

    function dragstarted(event, d) {
    if (!event.active) Simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    // Store the starting position for our distance calculation
    d.startX = d.x;
    d.startY = d.y;
}

    function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;

    // Give visual feedback if the node is being dragged far enough
    const distance = Math.sqrt(Math.pow(d.fx - d.startX, 2) + Math.pow(d.fy - d.startY, 2));
    if (!d.isCentral && distance > SNAP_OFF_THRESHOLD) {
        d3.select(event.sourceEvent.target.parentNode).classed('node-detaching', true);
    } else {
        d3.select(event.sourceEvent.target.parentNode).classed('node-detaching', false);
    }
}

    function dragended(event, d) {
    if (!event.active) Simulation.alphaTarget(0);

    d3.select(event.sourceEvent.target.parentNode).classed('node-detaching', false);
    const distance = Math.sqrt(Math.pow(d.fx - d.startX, 2) + Math.pow(d.fy - d.startY, 2));

    if (!d.isCentral && d.text && distance > SNAP_OFF_THRESHOLD) {
        const cluster = graphClusters.get(d.clusterId);
        if (cluster) {
            cluster.nodes = cluster.nodes.filter(n => n.id !== d.id);
            cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== d.id);
        }

        handleWordSubmitted(d.text, true, d);

    } else {
        d.fx = null;
        d.fy = null;
    }
}

    // --- Initialization ---
    renderInitialPrompt();
    controlsDock.addEventListener('click', handleDockClick);
    zoomControls.addEventListener('click', handleZoomControlsClick);
    registerToggleBtn.addEventListener('click', handleRegisterToggle);
    window.addEventListener('resize', handleResize);
    document.addEventListener('keydown', (event) => { if (event.key === "Escape") languageModal.classList.remove('visible'); });
    modalCloseBtn.addEventListener('click', () => languageModal.classList.remove('visible'));
    languageModal.addEventListener('click', (event) => { if (event.target === languageModal) languageModal.classList.remove('visible'); });
    languageList.addEventListener('click', (event) => {
        if (event.target.tagName === 'LI') {
            const selectedLang = event.target.dataset.lang;
            languageModal.classList.remove('visible');
            generateGraphForView('translation', { language: selectedLang });
        }
    });
});