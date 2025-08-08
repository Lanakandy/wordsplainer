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
            throw new Error(`Failed to fetch ${type} for "${word}": ${error.message}`);
        }
    }

    // --- START OF ENHANCED FUNCTIONS (from enhanced_graph_functions.js) ---

    // ⭐ NEW: Simplified and more predictable clustering force
    function forceCluster() {
        const strength = 0.2; // A bit stronger to keep things tight

        return function(alpha) {
            const allNodes = getConsolidatedGraphData().nodes;
            
            for (let node of allNodes) {
                if (node.isCentral || !node.clusterId || !graphClusters.has(node.clusterId)) {
                    continue; // Skip central nodes (they are pinned) and orphans
                }

                const cluster = graphClusters.get(node.clusterId);
                const target = cluster.center; // The pinned center of the graph

                // Gently pull peripheral nodes towards the cluster's center
                node.vx += (target.x - node.x) * strength * alpha;
                node.vy += (target.y - node.y) * strength * alpha;
            }
        };
    }

    // Enhanced collision detection with adaptive radii
function getCollisionRadius(d) {
    if (d.isCentral) {
        return 60; // Larger radius for the central node to push others away
    }
    if (d.width && d.height) {
        // Use half the diagonal for example boxes
        return Math.sqrt(d.width * d.width + d.height * d.height) / 2 + 15; // +padding
    }
    if (d.type === 'add') {
        return 25;
    }
    // Default for regular peripheral nodes
    return 45; // Increased radius to prevent text overlap
}

    // Enhanced simulation with better forces
    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink()
            .id(d => d.id)
            .distance(d => {
                if (d.target.type === 'example') return 100;
                return 150; // A good default distance from the center
            })
            .strength(0.7)
        )
        .force("charge", d3.forceManyBody()
            .strength(d => d.isCentral ? -1500 : -400) // Stronger repulsion from center
            .distanceMax(500)
        )
        .force("collision", d3.forceCollide()
            .radius(getCollisionRadius)
            .strength(0.9) // Strong collision to prevent overlap
        )
        .force("cluster", forceCluster()); // Our new, simpler cluster force

     /**
     * Counts the number of "notional" (meaningful) words in a string.
     * This helps differentiate single words from phrases.
     * @param {string} text The text to analyze.
     * @returns {number} The count of notional words.
     */
    function countNotionalWords(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }
        // A simple list of common English stopwords.
        const stopwords = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'for', 'to', 'of', 'with', 'by', 'is', 'am', 'are', 'was', 'were']);
        
        const words = text.toLowerCase().split(/\s+/);
        
        const notionalWords = words.filter(word => {
            const cleanedWord = word.replace(/[.,!?;:"]+/g, ''); // Remove punctuation
            // A word is considered "notional" if it's not a stopword and has more than 1 letter.
            return cleanedWord.length > 1 && !stopwords.has(cleanedWord);
        });
        
        return notionalWords.length;
    }

    // Enhanced graph update with smooth animations
    function updateGraph() {
        const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();

        const visibleNodes = allNodes.filter(n => n.visible !== false);
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const visibleLinks = allLinks.filter(l => 
            visibleNodeIds.has(l.source.id || l.source) &&
            visibleNodeIds.has(l.target.id || l.target)
        );
        
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll(".status-text, .prompt-plus, .loading-spinner").remove();

        const textBoxTypes = ['example'];

        // Enhanced link rendering with animations
        graphGroup.selectAll(".link")
            .data(visibleLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
            .join(
                enter => {
                    const links = enter.append("line")
                        .attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`)
                        .style("opacity", 0)
                        .style("stroke-width", 0);
                    
                    links.transition()
                        .duration(800)
                        .delay((d, i) => i * 50)
                        .ease(d3.easeCircleOut)
                        .style("opacity", 1)
                        .style("stroke-width", d => d.type === 'cross-cluster' ? 2 : 1);
                    
                    return links;
                },
                update => update.attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`),
                exit => exit.transition()
                    .duration(400)
                    .ease(d3.easeCircleIn)
                    .style("opacity", 0)
                    .style("stroke-width", 0)
                    .remove()
            );

        // Enhanced node rendering with staggered animations
        const nodeGroups = graphGroup.selectAll(".node")
            .data(visibleNodes, d => d.id)
            .join(
                enter => {
                    const nodeGroup = enter.append("g")
                        .attr("class", d => `node ${d.isCentral ? 'central-node' : `node-${d.type}`}`)
                        .style("opacity", 0)
                        .attr("transform", d => {
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

                    nodeGroup.append(d => 
                        textBoxTypes.includes(d.type) ? 
                        document.createElementNS(d3.namespaces.svg, 'rect') : 
                        document.createElementNS(d3.namespaces.svg, 'circle')
                    );

                    nodeGroup.append("text");

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

    // --- Clear previous shapes to prevent rendering artifacts ---
    selection.selectAll("circle, rect, foreignObject, text").remove();

    if (d.isCentral) {
        selection.append("circle")
            .attr("r", 45)
            .style("filter", "drop-shadow(0 0 10px var(--primary-coral))");
        
        selection.append("text")
            .attr("class", "node-text")
            .text(d.word || d.id)
            .attr("dy", "0.3em")
            .style("font-weight", "bold")
            .style("font-size", "16px");
            
    } else if (d.type === 'add') {
        selection.append("circle").attr("r", 20);
        selection.append("text")
            .text('+')
            .style("font-size", "24px")
            .style("font-weight", "300")
            .style("fill", "var(--primary-coral)");
            
    } else {
    // --- RENDER ALL PERIPHERAL NODES (DEFINITIONS, EXAMPLES, ETC.) ---
    const isExample = d.type === 'example';
    
    // For non-example nodes, create the interactive colored circle
    if (!isExample) {
        selection.append("circle").attr("r", 18);
    }

    // Determine the width for the text container
    const textWidth = isExample ? 220 : 200;
    const PADDING = isExample ? 0 : 12; // No padding for examples
    const circleRadius = isExample ? 0 : 18;

    // Use <foreignObject> for robust text wrapping and styling
    const foreignObject = selection.append("foreignObject")
        .attr("class", "node-html-wrapper")
        .attr("width", textWidth)
        .attr("x", isExample ? -textWidth / 2 : circleRadius + PADDING) // Center examples, offset others
        .style("opacity", 0);

    const div = foreignObject.append("xhtml:div")
        .attr("class", "node-html-content");

    // Populate the div with interactive text
    createInteractiveText(div, d.text, (word) => handleWordSubmitted(word, true, d));

    // After the browser renders the div, calculate its height and set final dimensions
    setTimeout(() => {
        if(div.node()) {
            const textHeight = div.node().scrollHeight;
            
            // Position vertically
            foreignObject.attr("height", textHeight)
                       .attr("y", isExample ? -textHeight / 2 : -textHeight / 2);

            // Update overall node size for collision detection
            d.width = isExample ? textWidth : circleRadius * 2 + PADDING + textWidth;
            d.height = Math.max(circleRadius * 2, textHeight);

            // Animate into view
            foreignObject.transition().duration(400).style("opacity", 1);
            
            simulation.alpha(0.1).restart(); // Nudge simulation with new size
        }
    }, 50);
    
    // The colored circle is for getting an example. The text is for exploring.
    selection.style("cursor", "pointer");
}
});
        graphGroup.selectAll(".link")
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

        simulation.nodes(visibleNodes);
        simulation.force("link").links(visibleLinks);
        simulation.alpha(1).restart();
        
        graphGroup.selectAll('.central-node').raise();
        
        updateCentralNodeState();
    }

    function handleMouseOver(event, d) {
        const selection = d3.select(event.currentTarget);
          if (d.type !== 'add') {
            selection.transition()
                .duration(200)
                .ease(d3.easeCircleOut)
                .attr("transform", `translate(${d.x},${d.y}) scale(1.1)`);
        }
    
        if (d.isCentral) {
            selection.select("circle")
                .transition()
                .duration(200)
                .style("filter", "drop-shadow(0 0 20px var(--primary-coral))");
        } else if (d.type !== 'example' && d.type !== 'add') {
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
            const is_disabled = d3.select(event.currentTarget).classed('is-disabled');
            tooltipText = is_disabled ? 
                'No more items to load' :
                `Load more ${graphClusters.get(d.clusterId)?.currentView || 'items'}`;
        } else if (d.text && !d.isCentral && d.type !== 'example' && d.type !== 'add') {
            tooltipText = `Click circle for an example\nClick text to explore`;
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

    function handleMouseOut(event, d) {
        const selection = d3.select(event.currentTarget);
        
        if (d.type !== 'add') {
            selection.transition()
                .duration(200)
                .ease(d3.easeCircleOut)
                .attr("transform", `translate(${d.x},${d.y}) scale(1)`);
        }
        
        if (d.isCentral) {
            selection.select("circle")
                .transition()
                .duration(200)
                .style("filter", "drop-shadow(0 0 10px var(--primary-coral))");
        } else if (d.type !== 'example' && d.type !== 'add') {
            selection.select("circle")
                .transition()
                .duration(200)
                .style("stroke", "none");
        }
        
        tooltip.classList.remove('visible');
        tooltip.style.transform = 'translateY(0)';
        svg.on('mousemove.tooltip', null);
    }

    function handleNodeClick(event, d) {
        if (event.defaultPrevented) return;
        event.stopPropagation();
        
        const selection = d3.select(event.currentTarget);
        selection.transition()
            .duration(150)
            .ease(d3.easeCircleOut)
            .attr("transform", `translate(${d.x},${d.y}) scale(0.9)`)
            .transition()
            .duration(150)
            .ease(d3.easeCircleOut)
            .attr("transform", `translate(${d.x},${d.y}) scale(1)`);
        
        const exampleTypes = ['synonyms', 'opposites', 'derivatives', 'collocations', 'idioms', 'context', 'meaning', 'translation'];

        if (exampleTypes.includes(d.type)) {
            toggleExampleForNode(d);
        } else if (d.isCentral) {
            focusOnCentralNode(d.clusterId);
        } else if (d.type === 'add') {
            if (d3.select(event.currentTarget).classed('is-loading') || d3.select(event.currentTarget).classed('is-disabled')) {
                return;
            }
            fetchMoreNodes();
       }
    }
    
    // ⭐ MODIFIED: `handleWordSubmitted` to orchestrate the new layout and camera pan
    async function handleWordSubmitted(word, isNewCentral = true, sourceNode = null) {
        const lowerWord = word.toLowerCase();
        
        // Prevent duplicate central nodes
        if (isNewCentral) {
            if (centralNodes.some(c => c.word === lowerWord)) {
                const existingNode = centralNodes.find(n => n.word === lowerWord);
                if(existingNode) focusOnCentralNode(existingNode.clusterId);
                return;
            }

            // Create new central node data WITHOUT setting position yet
            const centralNodeData = { 
                word: lowerWord, id: `central-${lowerWord}`, 
                isCentral: true, type: 'central', clusterId: lowerWord,
                visible: true
            };
            
            centralNodes.push(centralNodeData);
            graphClusters.set(lowerWord, { 
                nodes: [centralNodeData], 
                links: [], 
                center: { x: 0, y: 0 }, // Placeholder center
                currentView: 'meaning' 
            });

            // Call the layout function to position all clusters
            const newClusterCenter = repositionAllClusters();
            
            // Pan the camera to the precisely calculated center of the new graph
            if (newClusterCenter) {
                panToNode(newClusterCenter, 1.2);
            }
        }

        currentActiveCentral = lowerWord;
        currentView = 'meaning';
        viewState = { offset: 0, hasMore: true };
        updateActiveButton();
        await generateGraphForView(currentView);
    }

    // ⭐ MODIFIED: `panToNode` to be more robust
    function panToNode(target, scale = 1.2) {
        // Check if the target is a valid node or a coordinate object
        if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
            console.error("panToNode called with invalid target:", target);
            return;
        }
        
        const { width, height } = graphContainer.getBoundingClientRect();
        
        // This transform centers the view on the target's data-space coordinates
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-target.x, -target.y);
        
        svg.transition()
            .duration(1000)
            .ease(d3.easeCubicInOut)
            .call(zoomBehavior.transform, transform);
    }
    
    // --- END OF ENHANCED FUNCTIONS ---

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

    simulation.on("tick", () => {
        graphGroup.selectAll('.link').attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
    });

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
            cluster.nodes = cluster.nodes.filter(n => n.id !== existingExample.id);
            cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== existingExample.id);
            updateGraph();
        } else {
            try {
                const requestBody = {
                    type: 'generateExample',
                    word: nodeData.text,
                    register: currentRegister,
                    sourceNodeType: nodeData.type
                };
                if (nodeData.type === 'meaning' || nodeData.type === 'context' || nodeData.type === 'translation') {
                    requestBody.centralWord = nodeData.clusterId;
                }
                if (nodeData.type === 'meaning') requestBody.definition = nodeData.text;
                if (nodeData.type === 'context') requestBody.context = nodeData.text;
                if (nodeData.type === 'translation') {
                    requestBody.translation = nodeData.text;
                    requestBody.language = nodeData.lang;
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
                if (data.english_example && data.translated_example) {
                    exampleText = `${data.english_example}\n${data.translated_example}`;
                } else if (data.example) {
                    exampleText = data.example;
                    if (data.explanation) exampleText += `\n\n(${data.explanation})`;
                }

                if (exampleText) {
                    const exId = `${nodeData.id}-ex`;
                    const exNode = {
                        id: exId, text: exampleText, type: 'example',
                        sourceNodeId: nodeData.id, clusterId: nodeData.clusterId, visible: true
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

    async function generateGraphForView(view, options = {}) {
        if (!currentActiveCentral) return renderError('No word selected.');
        
        const cluster = graphClusters.get(currentActiveCentral);
        if (!cluster) return renderError('Invalid word cluster.');

        const alreadyLoaded = cluster.nodes.some(n => n.type === view);

        if (alreadyLoaded) {
            console.log(`CACHE HIT for "${currentActiveCentral}" - view: ${view}`);
            cluster.currentView = view;
            currentView = view;
            updateActiveButton();

            cluster.nodes.forEach(node => {
                const isExample = node.type === 'example';
                if (!isExample) {
                    node.visible = node.isCentral || node.type === 'add' || node.type === view;
                } else {
                    const sourceNode = cluster.nodes.find(n => n.id === node.sourceNodeId);
                    node.visible = sourceNode ? sourceNode.visible : false;
                }
            });

            updateGraph();
            return;
        }

        console.log(`CACHE MISS for "${currentActiveCentral}" - view: ${view}. Fetching...`);
        cluster.currentView = view;
        currentView = view;
        updateActiveButton();
        renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);

        try {
            const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, options.language);
            if (!data || !data.nodes) throw new Error("No data received from server.");
            
            cluster.nodes.forEach(node => {
                if (!node.isCentral && node.type !== 'add') node.visible = false;
            });

            data.nodes.forEach(nodeData => {
                if (!nodeData || typeof nodeData.text !== 'string') return;
                const nodeId = `${currentActiveCentral}-${nodeData.text.slice(0, 10)}-${view}`;
                if (cluster.nodes.some(n => n.id === nodeId)) return;

                const newNode = {
                    ...nodeData, id: nodeId, type: view,
                    clusterId: currentActiveCentral, visible: true, lang: options.language 
                };
                cluster.nodes.push(newNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNode.id });
            });
            
            const addNodeId = `add-${currentActiveCentral}`;
            let addNode = cluster.nodes.find(n => n.id === addNodeId);
            if (!addNode) {
                addNode = { id: addNodeId, type: 'add', clusterId: currentActiveCentral };
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
                if (value) { handleWordSubmitted(value, true); }
                inputOverlay.classList.remove('visible');
                overlayInput.removeEventListener('keydown', handleKeyDown);
                overlayInput.removeEventListener('blur', handleBlur);
            }
        };
        const handleBlur = () => {
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
            case 'zoom-in-btn': svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.2); break;
            case 'zoom-out-btn': svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.8); break;
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
                cluster.nodes = cluster.nodes.filter(n => n.isCentral || n.type === 'add');
                const addNode = cluster.nodes.find(n => n.id === `add-${currentActiveCentral}`);
                cluster.links = addNode ? [{ source: `central-${currentActiveCentral}`, target: addNode.id }] : [];
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
                panToNode(cluster.center, 1.2);
            }
            updateCentralNodeState();
            console.log(`Focused on central node: ${clusterId}`);
        }
    }

    function createInteractiveText(d3Element, text, onWordClick) {
        const isSvg = d3Element.node().tagName.toLowerCase() === 'text';
        d3Element.html("");

        const lines = text.split('\n');
        lines.forEach((line, lineIndex) => {
            if (lineIndex > 0 && !isSvg) {
                d3Element.append("br");
            }
            
            const tokens = line.split(/(\s+|[.,!?;:"])/g).filter(t => t);
            
            const lineContainer = isSvg ? 
                d3Element.append('tspan').attr('x', 0).attr('dy', lineIndex === 0 ? '0.3em' : '1.4em') : 
                d3Element;

            tokens.forEach(token => {
                const cleanedToken = token.trim().toLowerCase().replace(/[.,!?;:"]+/g, '');
                if (cleanedToken.length > 1 && /^[a-z']+$/.test(cleanedToken)) {
                    lineContainer.append('span')
                        .attr('class', 'interactive-word')
                        .text(token)
                        .on('click', (event) => {
                            event.stopPropagation();
                            if(token) onWordClick(token);
                        });
                } else {
                    lineContainer.append('span').text(token);
                }
            });
        });
    }

    // ⭐ NEW: The core "film strip" layout function
    const CLUSTER_SPACING = 700; // Horizontal distance between graph centers

    function repositionAllClusters() {
        if (centralNodes.length === 0) return null;

        const { width, height } = graphContainer.getBoundingClientRect();
        
        // Find the data-space coordinates of the screen's center
        const currentTransform = d3.zoomTransform(svg.node());
        const viewCenterX = (width / 2 - currentTransform.x) / currentTransform.k;
        const viewCenterY = (height / 2 - currentTransform.y) / currentTransform.k;

        const lastNodeIndex = centralNodes.length - 1;
        let lastNodeCenter = null;

        // Arrange all clusters in a horizontal line
        centralNodes.forEach((node, i) => {
            const cluster = graphClusters.get(node.clusterId);
            if (cluster) {
                // Calculate position relative to the last node
                // The last node (newest) will be at the view's center
                const targetX = viewCenterX - ((lastNodeIndex - i) * CLUSTER_SPACING);
                const targetY = viewCenterY;

                // Pin the central node to this calculated position
                node.fx = targetX;
                node.fy = targetY;
                
                // Update the cluster's center property for child nodes to follow
                cluster.center.x = targetX;
                cluster.center.y = targetY;

                // Store the coordinates of the newest graph's center
                if (i === lastNodeIndex) {
                    lastNodeCenter = { x: targetX, y: targetY };
                }
            }
        });

        // Nudge the simulation to apply the new positions
        simulation.alpha(0.5).restart();
        
        // Return the center of the newest cluster so we can pan to it
        return lastNodeCenter;
    }

    function handleResize() {
        const { width, height } = graphContainer.getBoundingClientRect();
        svg.attr("width", width).attr("height", height);
        
        if (centralNodes.length > 0) {
            repositionAllClusters(); // Re-calculate layout on resize
        } else {
            renderInitialPrompt();
        }
    }

    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveCentral);
        // Exit if no cluster or no more data is available
        if (!currentActiveCentral || !cluster || !viewState.hasMore) return;
        
        // Find the specific 'add' node element for this cluster
        const addNodeElement = graphGroup.selectAll('.node-add').filter(node_d => node_d.clusterId === currentActiveCentral);
        
        // If it's already loading, do nothing.
        if (addNodeElement.classed('is-loading')) return;
    
        // Set the loading state ON
        addNodeElement.classed('is-loading', true);
        
        try {
            const data = await fetchData(currentActiveCentral, cluster.currentView, viewState.offset, 3);
            if (data.nodes.length > 0) {
                data.nodes.forEach(newNodeData => {
                    if (!newNodeData || typeof newNodeData.text !== 'string') return;
                    const newNodeId = `${currentActiveCentral}-${newNodeData.text.slice(0, 10)}-${cluster.currentView}`; // Use slice to avoid overly long IDs
                    if (!cluster.nodes.some(n => n.id === newNodeId)) {
                        const newNode = { ...newNodeData, id: newNodeId, type: cluster.currentView, clusterId: currentActiveCentral, visible: true };
                        cluster.nodes.push(newNode);
                        cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNodeId });
                    }
                });
                viewState.offset += data.nodes.length;
                viewState.hasMore = data.hasMore; // This is key
                detectCrossConnections();
                updateGraph();
            } else {
                viewState.hasMore = false;
            }
        } catch (error) {
            console.error("Failed to fetch more nodes:", error);
            // We can show an error on the tooltip
            tooltip.textContent = "Error loading.";
            tooltip.classList.add('visible');
            setTimeout(() => tooltip.classList.remove('visible'), 2000);
        } finally {
            // Set the loading state OFF
            addNodeElement.classed('is-loading', false);
            
            // If there are no more nodes, permanently disable the button
            if (!viewState.hasMore) {
                addNodeElement.classed('is-disabled', true);
            }
            updateCentralNodeState(); // Call the function here
        }
    } // <-- FIX: This brace closes the fetchMoreNodes function.
    
    // FIX: All subsequent functions are now in the correct scope.
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
    if (centralNodes.length === 0) {
        alert("Nothing to save yet!");
        return;
    }

    // --- 1. ACCURATE BOUNDING BOX CALCULATION ---
    const allNodes = getConsolidatedGraphData().nodes;
    if (allNodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // This new logic calculates the box based on the full visual extent of each node,
    // not just its center point, which fixes the clipping issue.
    allNodes.forEach(d => {
        const nodeWidth = d.width || (d.isCentral ? 90 : 40); // Use stored width, or estimate
        const nodeHeight = d.height || (d.isCentral ? 90 : 40);
        minX = Math.min(minX, d.x - nodeWidth / 2);
        maxX = Math.max(maxX, d.x + nodeWidth / 2);
        minY = Math.min(minY, d.y - nodeHeight / 2);
        maxY = Math.max(maxY, d.y + nodeHeight / 2);
    });

    const padding = 100; // Generous padding for aesthetics
    const exportWidth = (maxX - minX) + 2 * padding;
    const exportHeight = (maxY - minY) + 2 * padding;

    // --- 2. CREATE A TEMPORARY SVG IN MEMORY ---
    const tempSvg = d3.create('svg')
        .attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('width', exportWidth)
        .attr('height', exportHeight)
        .attr('viewBox', `0 0 ${exportWidth} ${exportHeight}`);

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    tempSvg.attr('data-theme', currentTheme); // This now works with our updated CSS

    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    tempSvg.append('rect')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('fill', bgColor);
        
    const tempGroup = tempSvg.append('g')
        .attr('transform', `translate(${-minX + padding}, ${-minY + padding})`);

    // --- 3. EMBED ALL STYLES ---
    const style = tempSvg.append('style');
    let cssText = "";
    for (const sheet of document.styleSheets) {
        try {
            if (sheet.cssRules) {
                for (const rule of sheet.cssRules) {
                    cssText += rule.cssText + '\n';
                }
            }
        } catch (e) { console.warn("Cannot read CSS rules from stylesheet: " + e); }
    }
    style.text(cssText);

    // --- 4. CLONE THE LIVE GRAPH CONTENT ---
    graphGroup.selectAll('.link').each(function() {
        tempGroup.node().appendChild(this.cloneNode(true));
    });
    graphGroup.selectAll('.node').each(function() {
        tempGroup.node().appendChild(this.cloneNode(true));
    });

    // --- 5. SERIALIZE AND RENDER ---
    const svgString = new XMLSerializer().serializeToString(tempSvg.node());
    const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

    const image = new Image();
    image.src = svgDataUrl;
    
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth;
        canvas.height = exportHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png', 1.0);
        a.download = `Wordsplainer-infographic.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    image.onerror = (e) => {
        console.error('Failed to load SVG into image:', e);
        alert('An error occurred while creating the image. Please check the console.');
    };
}
    // ⭐ MODIFIED: Drag handlers to respect the pinned central nodes
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        // For peripheral nodes, we allow dragging. For central, we use their fixed fx,fy.
        d.fx = d.isCentral ? d.fx : d.x;
        d.fy = d.isCentral ? d.fy : d.y;
    }

    function dragged(event, d) {
        // Only update fx/fy for non-central nodes
        if (!d.isCentral) {
            d.fx = event.x;
            d.fy = event.y;
        }
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        // We only un-fix peripheral nodes. Central nodes remain pinned to the film strip.
        if (!d.isCentral) {
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