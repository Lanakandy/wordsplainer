// script.js - CORRECTED

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
    
    // ⭐ FIX 1: Use the correct variable name 'registerToggleBtn'
    if (registerToggleBtn) {
        registerToggleBtn.addEventListener('click', () => {
            // This toggles the .is-academic class on the button itself
            registerToggleBtn.classList.toggle('is-academic');

            // You can get the current state to use in your logic
            const isAcademic = registerToggleBtn.classList.contains('is-academic');
            
            console.log('Register is now:', isAcademic ? 'Academic' : 'Conversational');
            
            // TODO: Add your logic here to update the graph based on the new register.
            // For example, you might call a function like:
            // updateGraphForRegister(isAcademic);
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

    // --- Central API fetching function ---
    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
        const response = await fetch('/.netlify/functions/wordsplainer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // ⭐ FIX 2: Use 'currentRegister' instead of the undefined 'register'
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
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        return response.json();
    }

    function forceCluster() {
        let strength = 0.1;
        return function(alpha) {
            const allNodes = getConsolidatedGraphData().nodes;
            for (let node of allNodes) {
                if (node.clusterId && graphClusters.has(node.clusterId)) {
                    const cluster = graphClusters.get(node.clusterId);
                    const target = cluster.center;
                    const strengthFactor = node.isCentral ? 2 : 0.3;
                    node.vx += (target.x - node.x) * strength * alpha * strengthFactor;
                    node.vy += (target.y - node.y) * strength * alpha * strengthFactor;
                }
            }
        };
    }

    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(d => d.type === 'cross-cluster' ? 200 : 150))
        .force("charge", d3.forceManyBody().strength(-400))
        .force("collision", d3.forceCollide().radius(d => d.isCentral ? 45 : 20))
        .force("cluster", forceCluster())
        .force("center", d3.forceCenter());

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

function updateGraph() {
    const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();
    const { width, height } = graphContainer.getBoundingClientRect();
    graphGroup.selectAll(".status-text, .prompt-plus, .loading-spinner").remove();

    // ⭐ CHANGE: Define all text-box types in one place for easy maintenance.
    const textBoxTypes = ['meaning', 'example', 'context', 'idioms'];

    graphGroup.selectAll(".link")
        .data(allLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
        .join(
            enter => enter.append("line")
                // Use the new array to assign the correct class
                .attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`)
                .style("opacity", 0)
                .transition().duration(600).delay(200)
                .style("opacity", 1),
            update => update.attr("class", d => `link ${textBoxTypes.includes(d.target.type) ? 'link-example' : ''}`),
            exit => exit.transition().duration(300)
                .style("opacity", 0)
                .remove()
        );

    graphGroup.selectAll(".node")
        .data(allNodes, d => d.id)
        .join(
            enter => {
                const nodeGroup = enter.append("g")
                    .call(d3.drag()
                        .on("start", dragstarted)
                        .on("drag", dragged)
                        .on("end", dragended)
                        .filter(event => !event.target.classList.contains('interactive-word'))
                    )
                    .on("mouseover", handleMouseOver)
                    .on("mouseout", handleMouseOut)
                    .on("click", handleNodeClick)
                    .attr("transform", d => `translate(${d.x || width / 2}, ${d.y || height / 2})`);

                // Use the new array to decide whether to draw a rect or circle
                nodeGroup.append(d => textBoxTypes.includes(d.type) ? document.createElementNS(d3.namespaces.svg, 'rect') : document.createElementNS(d3.namespaces.svg, 'circle'));

                nodeGroup.select("circle")
                    .attr("r", 0)
                    .transition()
                    .duration(400)
                    .ease(d3.easeElasticOut.amplitude(1).period(0.5))
                    .attr("r", d => d.isCentral ? 40 : 15);
                
                nodeGroup.select("rect").style("opacity", 0);
                nodeGroup.append("text");

                nodeGroup.style("opacity", 0)
                    .transition()
                    .duration(300)
                    .delay(150)
                    .style("opacity", 1);
                
                return nodeGroup;
            },
            update => update,
            exit => exit.transition()
                .duration(200)
                .ease(d3.easeCircleIn)
                .attr("transform", d => `translate(${d.x}, ${d.y}) scale(0)`)
                .remove()
        )
        .attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : `node-${d.type}`}`)
        .each(function(d) {
            const selection = d3.select(this);
            const textElement = selection.select("text");
            
            if (d.isCentral) {
                // (This part is unchanged and correct)
                textElement.attr("class", "node-text").text(d.word || d.id).attr("dy", "0.3em");
                // ... phonetic text logic ...
            } else if (d.type === 'add') {
                // (This part is unchanged and correct)
                textElement.text('+').style("font-size", "24px").style("font-weight", "300").style("fill", "white").style("stroke", "none");
                // ... color logic ...
            } else if (textBoxTypes.includes(d.type)) {
                selection.select("rect").attr("class", "example-bg"); 
                
                let fullText = d.text;
                if (d.explanation) {
                    fullText += `\n(${d.explanation})`; // Display the explanation
                }

                if (d.type === 'meaning' && d.examples && d.examples.length > 0) {
                    const exampleLines = d.examples.map(ex => `\n  •  ${ex}`).join('');
                    fullText += exampleLines;
                }
                
                createInteractiveText(textElement, fullText, (word) => handleWordSubmitted(word, true, d));

                setTimeout(() => {
                    const bbox = textElement.node()?.getBBox();
                    if (bbox && bbox.width > 0) {
                        selection.select("rect")
                            .attr("width", bbox.width + 20)
                            .attr("height", bbox.height + 10)
                            .attr("x", bbox.x - 10)
                            .attr("y", bbox.y - 5)
                            .transition().duration(200).style("opacity", 1);
                    }
                }, 0);
            } else {
                // This correctly handles all other types (synonym, opposite, etc.)
                textElement.text(d.text || d.id).attr("dy", -22);
            }
        });

    graphGroup.selectAll(".link").style("stroke", d => d.type === 'cross-cluster' ? '#ff6b6b' : '#999').style("stroke-width", d => d.type === 'cross-cluster' ? 2 : 1).style("stroke-dasharray", d => d.type === 'cross-cluster' ? "5,5" : "none");

    simulation.nodes(allNodes);
    simulation.force("link").links(allLinks);
    simulation.force("center").x(width / 2).y(height / 2);
    simulation.alpha(1).restart();
    graphGroup.selectAll('.central-node').raise();
    
    updateCentralNodeState();
}

    simulation.on("tick", () => {
        graphGroup.selectAll('.link').attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
    });

function panToNode(node, scale = 1.2) {
    if (!node) return;
    const { width, height } = graphContainer.getBoundingClientRect();
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-node.x, -node.y);
    
    svg.transition()
        .duration(750)
        .ease(d3.easeCubicOut)
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
        cluster.nodes = cluster.nodes.filter(n => n.id !== existingExample.id);
        cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== existingExample.id);
        updateGraph();
    } else {
        try {
            // ⭐ FIX: Add the 'register' property to the request body
            // This ensures on-demand examples respect the user's choice.
            const body = {
                type: 'generateExample',
                word: nodeData.text,
                register: currentRegister, 
                ...(nodeData.type === 'context' && {
                    centralWord: nodeData.clusterId,
                    context: nodeData.text
                })
            };

            const response = await fetch('/.netlify/functions/wordsplainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server returned an error.');
            }

            const data = await response.json();

            if (data.example) {
                const exId = `${nodeData.id}-ex`;
                const exNode = {
                    id: exId,
                    text: data.example,
                    type: 'example',
                    sourceNodeId: nodeData.id,
                    clusterId: nodeData.clusterId
                };
                cluster.nodes.push(exNode);
                cluster.links.push({ source: nodeData.id, target: exId, type: 'example' });
                updateGraph();
            }
        } catch (error) {
            console.error("Error getting example:", error);
            alert(`Sorry, we couldn't generate an example. Reason: ${error.message}`);
        }
    }
}   

    // REPLACE your handleWordSubmitted function with this new, more powerful version
async function handleWordSubmitted(word, isNewCentral = true, sourceNode = null) {
    const lowerWord = word.toLowerCase();
    
    if (isNewCentral) {
        if (centralNodes.some(c => c.word === lowerWord)) {
            focusOnCentralNode(lowerWord);
            return;
        }

        const { width, height } = graphContainer.getBoundingClientRect();
        let newCenter;
        
        // Determine the position for the new graph's center
        if (sourceNode) {
            // Place it to the right of the node that triggered it
            newCenter = { x: sourceNode.x + 450, y: sourceNode.y };
        } else {
            // This is the very first word, place it in the middle of the screen
            const currentTransform = d3.zoomTransform(svg.node());
            newCenter = { 
                x: (width / 2 - currentTransform.x) / currentTransform.k, 
                y: (height / 2 - currentTransform.y) / currentTransform.k 
            };
        }

        const centralNodeData = { 
            word: lowerWord, 
            id: `central-${lowerWord}`, 
            isCentral: true, 
            type: 'central', 
            clusterId: lowerWord,
            x: newCenter.x, // Set initial position
            y: newCenter.y,
            fx: newCenter.x, // Fix its position initially to avoid wild simulation swings
            fy: newCenter.y
        };
        
        // Unfix the position after a short delay to let the simulation take over smoothly
        setTimeout(() => {
            centralNodeData.fx = null;
            centralNodeData.fy = null;
        }, 1500);

        centralNodes.push(centralNodeData);
        graphClusters.set(lowerWord, { 
            nodes: [centralNodeData], 
            links: [], 
            center: newCenter, // The 'center' for the cluster force is the node itself
            currentView: 'meaning' 
        });

        // Pan to the new node *before* fetching data
        panToNode(centralNodeData, 1.2);
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
        
        cluster.currentView = view;
        currentView = view;
        updateActiveButton();
        renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);

        try {
            const centralNode = cluster.nodes.find(n => n.isCentral);
            const initialX = centralNode ? centralNode.x : (graphContainer.getBoundingClientRect().width / 2);
            const initialY = centralNode ? centralNode.y : (graphContainer.getBoundingClientRect().height / 2);
            
            const languageForRequest = (view === 'translation' && options.language) ? options.language : null;
            const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, languageForRequest);

            const keptNodeIds = new Set(cluster.nodes.filter(n => n.isCentral || n.type === 'add').map(n => n.id));
            cluster.nodes = cluster.nodes.filter(n => keptNodeIds.has(n.id));
            cluster.links = cluster.links.filter(l => {
                const sourceId = l.source.id || l.source;
                const targetId = l.target.id || l.target;
                return keptNodeIds.has(sourceId) && keptNodeIds.has(targetId);
            });

            data.nodes.forEach(nodeData => {
                if (!nodeData || typeof nodeData.text !== 'string') return;
                
                const nodeId = `${currentActiveCentral}-${nodeData.text}-${view}`;
                if (cluster.nodes.some(n => n.id === nodeId)) return;
                if (nodeData.text.toLowerCase().includes('no data')) return;

                const newNode = {
                    ...nodeData,
                    id: nodeId,
                    type: view,
                    clusterId: currentActiveCentral,
                    x: initialX,
                    y: initialY
                };

                if (view === 'translation') {
                    newNode.lang = options.language;
                    newNode.exampleTranslations = data.exampleTranslations;
                }

                cluster.nodes.push(newNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNode.id });
            });

            const addNodeId = `add-${currentActiveCentral}`;
            if (!cluster.nodes.some(n => n.id === addNodeId)) {
                const addNode = { id: addNodeId, type: 'add', clusterId: currentActiveCentral, x: initialX, y: initialY };
                cluster.nodes.push(addNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: addNode.id });
            }
            viewState = { offset: data.nodes.length, hasMore: data.hasMore, total: data.total };
            
            detectCrossConnections();
            updateGraph();

        } catch (error) {
            console.error("Error generating graph:", error);
            renderError(error.message);
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
        // 1. Flip the state
        currentRegister = (currentRegister === 'conversational') ? 'academic' : 'conversational';
        
        // 2. Update the button's class for styling
        registerToggleBtn.classList.toggle('is-academic', currentRegister === 'academic');
        
        // 3. If a word is currently active, re-fetch its data with the new register
        if (currentActiveCentral) {
            console.log(`Register changed to '${currentRegister}'. Re-fetching for '${currentActiveCentral}'.`);
            // This will re-trigger the data fetch with the new `currentRegister` value
            generateGraphForView(currentView); 
        }
    }
   
    function handleNodeClick(event, d) {
    event.stopPropagation();
    const exampleTypes = ['synonyms', 'opposites', 'derivatives', 'collocations', 'idioms', 'context'];

    // If it's a node that provides examples, toggle them.
    if (exampleTypes.includes(d.type)) {
        return toggleExampleForNode(d);
    }

    // If it's the central node, focus on it.
    if (d.isCentral) {
        focusOnCentralNode(d.clusterId);
    }
    // If it's the '+' button, fetch more.
    else if (d.type === 'add') {
        fetchMoreNodes();
    }
    // Handle specific example types.
    else if (d.type === 'translation') {
        toggleTranslationExamples(d);
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
    let tooltipText = '';
    if (d.isCentral) {
        const cluster = graphClusters.get(d.clusterId);
        if (cluster) {
            const isPaginated = cluster.currentView !== 'meaning';
            if (isPaginated && viewState.hasMore) {
                tooltipText = `Click '+' to load more ${cluster.currentView}`;
            } else {
                tooltipText = `Currently viewing ${cluster.currentView}`;
            }
        }
    } else if (d.type === 'add') {
        const cluster = graphClusters.get(d.clusterId);
        if (cluster && viewState.hasMore) {
            tooltipText = `Load more ${cluster.currentView} for "${d.clusterId}"`;
        } else {
            tooltipText = `No more ${cluster?.currentView || ''} to load`;
        }
    } 
       else if (d.text && !d.isCentral && d.type !== 'add' && d.type !== 'example') {
        tooltipText = `Drag to explore "${d.text}"`;
    }
        
    if (tooltipText) {
        tooltip.textContent = tooltipText;
        tooltip.classList.add('visible');
    }
    d3.select(event.currentTarget).classed('hover-highlight', true);
    svg.on('mousemove.tooltip', (e) => { tooltip.style.left = `${e.pageX + 15}px`; tooltip.style.top = `${e.pageY + 15}px`; });
}

    function handleMouseOut(event) {
        tooltip.classList.remove('visible');
        d3.select(event.currentTarget).classed('hover-highlight', false);
        svg.on('mousemove.tooltip', null);
    }
    
    function handleResize() {
        const { width, height } = graphContainer.getBoundingClientRect();
        svg.attr("width", width).attr("height", height);
        
        if (centralNodes.length > 0) {
            simulation.force("center").x(width / 2).y(height / 2);
            simulation.alpha(0.3).restart();
        } else {
            renderInitialPrompt();
    }
}

    function toggleTranslationExamples(translationNode) {
        const cluster = graphClusters.get(translationNode.clusterId);
        if (!cluster) return;
        const examplesShown = cluster.nodes.some(n => n.sourceNodeId === translationNode.id);
        if (examplesShown) {
            cluster.nodes = cluster.nodes.filter(n => n.sourceNodeId !== translationNode.id);
            cluster.links = cluster.links.filter(l => !l.target.sourceNodeId || l.target.sourceNodeId !== translationNode.id);
        } else {
            if (translationNode.exampleTranslations) {
                for (const [eng, trans] of Object.entries(translationNode.exampleTranslations)) {
                    const langTrans = trans[translationNode.lang] || "N/A";
                    const exId = `${translationNode.id}-ex-${eng.slice(0, 10)}`;
                    const exNode = { id: exId, text: `${eng}\n${langTrans}`, type: 'example', sourceNodeId: translationNode.id, clusterId: translationNode.clusterId };
                    cluster.nodes.push(exNode);
                    cluster.links.push({ source: translationNode.id, target: exId, type: 'example' });
                }
            }
        }
        detectCrossConnections();
        updateGraph();
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
                        const newNode = { ...newNodeData, id: newNodeId, type: cluster.currentView, clusterId: currentActiveCentral };
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
    if (!event.active) simulation.alphaTarget(0.3).restart();
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
    if (!event.active) simulation.alphaTarget(0);

    d3.select(event.sourceEvent.target.parentNode).classed('node-detaching', false);
    const distance = Math.sqrt(Math.pow(d.fx - d.startX, 2) + Math.pow(d.fy - d.startY, 2));

    if (!d.isCentral && d.text && distance > SNAP_OFF_THRESHOLD) {
        const cluster = graphClusters.get(d.clusterId);
        if (cluster) {
            cluster.nodes = cluster.nodes.filter(n => n.id !== d.id);
            cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== d.id);
        }
        
        // ⭐ CHANGE: Pass the snapped-off node 'd' as the source
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