// This function needs to be available globally for immediate execution
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
    const tooltip = document.getElementById('graph-tooltip');
    const svg = d3.select("#wordsplainer-graph-svg");
    const graphGroup = svg.append("g");

    // --- Enhanced State Management ---
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let explorationHistory = [];
    let currentActiveCentral = null;
    let clusterColors = d3.scaleOrdinal(d3.schemeCategory10);
    let allUserAddedNodes = new Map();

    let currentView = 'meaning';
    let viewState = { offset: 0, hasMore: true };

    // --- MOVED AND CORRECTED: Central API fetching function ---
    // This helper function now lives in the main scope and can be used by any other function.
    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
        const response = await fetch('/.netlify/functions/wordsplainer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                word: word,
                type: type,
                offset: offset,
                limit: limit,
                language: language // Pass language if it exists
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
        allUserAddedNodes.clear();
        currentActiveCentral = null;
        graphGroup.selectAll("*").remove();
        
        const { width, height } = graphContainer.getBoundingClientRect();
        const promptGroup = graphGroup.append("g")
            .attr("class", "node central-node")
            .style("cursor", "pointer")
            .on("click", handleAddWord);
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
        
        graphGroup.selectAll(".link").data(allLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`).join(
            enter => enter.append("line").attr("class", d => `link ${d.type === 'example' ? 'link-example' : ''}`).style("opacity", 0).transition().duration(600).delay(200).style("opacity", 1),
            update => update,
            exit => exit.transition().duration(300).style("opacity", 0).remove()
        );

    const nodeEnter = graphGroup.selectAll(".node").data(allNodes, d => d.id).join(
    enter => {
        const nodeGroup = enter.append("g")
            .attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : "node-" + d.type}`)
            .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended))
            .on("mouseover", handleMouseOver).on("mouseout", handleMouseOut)
            .attr("transform", d => `translate(${d.x}, ${d.y})`);

        nodeGroup.each(function(d) {
            const selection = d3.select(this);
            if (d.type === 'example' && !d.isUserAdded) {
                selection.append("rect").style("opacity", 0);
            } else {
                selection.append("circle")
                    .attr("r", 0) 
                    .on("click", handleNodeClick)
                    .transition()
                    .duration(400) 
                    .ease(d3.easeElasticOut.amplitude(1).period(0.5)) 
                    .attr("r", d.isCentral ? 40 : 15); 
            }
        });

        nodeGroup.each(function(d) {
            const selection = d3.select(this);
            let textElement;
            
            selection.style("opacity", 0)
                   .transition()
                   .duration(300)
                   .delay(150) 
                   .style("opacity", 1);

            if (d.isCentral) {
                textElement = selection.append("text")
                    .attr("class", "node-text")
                    .text(d.word || d.id)
                    .attr("dy", "0.3em");
            } else if (d.type === 'add') {
                textElement = selection.append("text")
                    .text('+')
                    .style("font-size", "24px")
                    .style("font-weight", "300")
                    .style("fill", "white")
                    .style("stroke", "none");
                const cluster = graphClusters.get(d.clusterId);
                if (cluster) {
                    const singularView = cluster.currentView.endsWith('s') ? cluster.currentView.slice(0, -1) : cluster.currentView;
                    selection.select('circle').style("fill", `var(--${singularView}-color)`);
                }
            } else if (d.type === 'example' && !d.isUserAdded) {
                const textElementRef = selection.append("text")
                    .attr("x", 10).attr("y", 15);

                const lines = d.text.split('\n');
                textElementRef.selectAll("tspan").data(lines).enter().append("tspan")
                    .attr("x", 10).attr("dy", (l, i) => i === 0 ? 0 : "1.2em").text(t => t)
                    .attr("class", (l, i) => i === 1 ? "example-translation" : null);

                const bbox = textElementRef.node().getBBox();
                selection.select("rect")
                    .attr("width", bbox.width + 20).attr("height", bbox.height + 10).attr("y", -2)
                    .transition().duration(200).style("opacity", 1); 
            } else {
                textElement = selection.append("text")
                    .text(d.text || d.id)
                    .attr("dy", -22);
            }

            if (textElement && d.type !== 'example' && d.type !== 'add') {
                textElement.on("click", handleLabelClick);
            }
        });
        return nodeGroup;
    },
    update => update.attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : "node-" + d.type}`),
    exit => exit.transition()
        .duration(200)
        .ease(d3.easeCircleIn)
        .attr("transform", d => `translate(${d.x}, ${d.y}) scale(0)`)
        .remove()
);

graphGroup.selectAll(".link")
    .data(allLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
    .join(
        enter => enter.append("line")
            .attr("class", d => `link ${d.type === 'example' ? 'link-example' : ''}`)
            .style("opacity", 0) 
            .transition()
            .duration(400)
            .delay(200)     
            .style("opacity", 1),
        update => update,
        exit => exit.transition()
            .duration(200)
            .style("opacity", 0)
            .remove()
    );

        graphGroup.selectAll(".link").style("stroke", d => d.type === 'cross-cluster' ? '#ff6b6b' : '#999').style("stroke-width", d => d.type === 'cross-cluster' ? 2 : 1).style("stroke-dasharray", d => d.type === 'cross-cluster' ? "5,5" : "none");

        simulation.nodes(allNodes);
        simulation.force("link").links(allLinks);
        simulation.force("center").x(width / 2).y(height / 2);
        simulation.alpha(1).restart();
        graphGroup.selectAll('.central-node').raise();
    }

    simulation.on("tick", () => {
        graphGroup.selectAll('.link').attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function calculateClusterCenter(clusterIndex) {
        const { width, height } = graphContainer.getBoundingClientRect();
        const centerX = width / 2, centerY = height / 2;
        if (clusterIndex === 0) return { x: centerX, y: centerY };
        const radius = Math.min(width, height) * 0.25;
        const angle = (2 * Math.PI * (clusterIndex - 1)) / Math.max(1, centralNodes.length - 1);
        return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
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

    async function handleWordSubmitted(word, isNewCentral = true) {
        const lowerWord = word.toLowerCase();
        if (isNewCentral) {
            if (centralNodes.some(c => c.word === lowerWord)) {
                focusOnCentralNode(lowerWord);
                return;
            }
            const centralNodeData = { word: lowerWord, id: `central-${lowerWord}`, isCentral: true, type: 'central', clusterId: lowerWord };
            centralNodes.push(centralNodeData);
            graphClusters.set(lowerWord, { nodes: [centralNodeData], links: [], center: calculateClusterCenter(centralNodes.length - 1), currentView: 'meaning' });
            if (!allUserAddedNodes.has(lowerWord)) allUserAddedNodes.set(lowerWord, []);
        }
        currentActiveCentral = lowerWord;
        currentView = 'meaning';
        viewState = { offset: 0, hasMore: true };
        updateActiveButton();
        await generateGraphForView(currentView);
    }
    
    function focusOnCentralNode(centralWord) {
        currentActiveCentral = centralWord;
        const cluster = graphClusters.get(centralWord);
        if (cluster) {
            currentView = cluster.currentView;
            updateActiveButton();
            updateGraph();
            const { width, height } = graphContainer.getBoundingClientRect();
            const transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(1.2).translate(-cluster.center.x, -cluster.center.y);
            svg.transition().duration(750).call(zoomBehavior.transform, transform);
        }
    }

    function addUserNode(word) {
        const lowerWord = word.toLowerCase();
        const cluster = graphClusters.get(currentActiveCentral);
        if (!cluster) return false;
        
        const userNodes = allUserAddedNodes.get(currentActiveCentral) || [];
        if (cluster.nodes.some(n => n.text === lowerWord && n.type === cluster.currentView)) {
            alert(`"${word}" is already on the graph for this view.`);
            return false;
        }

        const newNode = { 
            id: `${currentActiveCentral}-user-${lowerWord}-${cluster.currentView}`,
            text: lowerWord, type: cluster.currentView, isUserAdded: true,
            clusterId: currentActiveCentral
        };
        userNodes.push(newNode);
        allUserAddedNodes.set(currentActiveCentral, userNodes);
        cluster.nodes.push(newNode);
        cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNode.id });
        detectCrossConnections();
        updateGraph();
        return true;
    }

    // --- CORRECTED SECTION: `generateGraphForView` ---
    async function generateGraphForView(view, options = {}) {
        if (!currentActiveCentral) return;
        const cluster = graphClusters.get(currentActiveCentral);
        if (!cluster) return;
        
        cluster.currentView = view;
        currentView = view;
        updateActiveButton();
        renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);

        try {
            // Find the central node to get its current position
            const centralNode = cluster.nodes.find(n => n.isCentral);
            const initialX = centralNode ? centralNode.x : (graphContainer.getBoundingClientRect().width / 2);
            const initialY = centralNode ? centralNode.y : (graphContainer.getBoundingClientRect().height / 2);
            
            // CORRECT: Call the helper function and await the data
            const languageForRequest = (view === 'translation' && options.language) ? options.language : null;
            const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, languageForRequest);

            // Clean up old nodes (except central, user-added, and add button)
            const keptNodeIds = new Set(cluster.nodes.filter(n => n.isCentral || n.isUserAdded || n.type === 'add').map(n => n.id));
            cluster.nodes = cluster.nodes.filter(n => keptNodeIds.has(n.id));
            cluster.links = cluster.links.filter(l => {
                const sourceId = l.source.id || l.source;
                const targetId = l.target.id || l.target;
                return keptNodeIds.has(sourceId) && keptNodeIds.has(targetId);
            });

            // Process new nodes from the API response
    data.nodes.forEach(nodeData => {
    // Check if a similar node (by text) already exists from the API for this view.
    const nodeId = `${currentActiveCentral}-${nodeData.text}-${view}`;
    if (cluster.nodes.some(n => n.id === nodeId)) return;
    if (nodeData.text.toLowerCase().includes('no data')) return;

    // Create the new node. The backend now standardizes the structure for us.
    const newNode = {
        ...nodeData, // This will include 'text' and potentially 'examples'
        id: nodeId,
        type: view,
        clusterId: currentActiveCentral,
        x: initialX,
        y: initialY
    };

    // For translations, attach the language code and the example translations object
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
            updateCentralNodeState();

        } catch (error) {
            console.error("Error generating graph:", error);
            renderError(error.message); // Display the error message on the graph
        }
    }


    function handleAddWord() {
        const inputOverlay = document.getElementById('input-overlay');
        const overlayInput = document.getElementById('overlay-input');
        const isAddingToCluster = !!currentActiveCentral;
        const placeholder = isAddingToCluster ? `Add a related '${graphClusters.get(currentActiveCentral).currentView}'...` : "Type a word and press Enter...";
        overlayInput.placeholder = placeholder;
        inputOverlay.classList.add('visible');
        overlayInput.focus();
        overlayInput.value = '';
        const handleKeyDown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const value = overlayInput.value.trim();
                if (value) {
    if (isAddingToCluster) {
        validateAndAddNode(value); // <<< CALL OUR NEW LOGIC HANDLER
    } else {
        handleWordSubmitted(value);
    }
}
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
    

async function validateAndAddNode(word) {
    if (!currentActiveCentral) return;
    const cluster = graphClusters.get(currentActiveCentral);
    if (!cluster) return;

    // For UX: Show a temporary loading/validation message
    tooltip.textContent = `Validating "${word}"...`;
    tooltip.classList.add('visible');
    // A bit of a hack to position the tooltip near the center
    const { width, height } = graphContainer.getBoundingClientRect();
    tooltip.style.left = `${width / 2 + 15}px`;
    tooltip.style.top = `${height / 2 + 15}px`;


    try {
        const response = await fetch('/.netlify/functions/validateWord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                centralWord: currentActiveCentral,
                userWord: word,
                relationship: cluster.currentView
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Validation server error: ${response.status}`);
        }

        const validation = await response.json();

        // --- The "Validate and Branch" Logic ---
        if (validation.isValid) {
            // The LLM agrees! Add the node to the current graph.
            addUserNode(word);
            tooltip.textContent = `Added "${word}"!`;
            setTimeout(() => tooltip.classList.remove('visible'), 2000);
        } else {
            // The LLM disagrees. Alert the user and start a new graph.
            tooltip.classList.remove('visible'); // Hide loading tooltip first
            alert(`Could not add word: ${validation.reason}\n\nCreating a new graph for "${word}" instead.`);
            handleWordSubmitted(word, true); // The magic "branching" call
        }

    } catch (error) {
        console.error("Validation failed:", error);
        tooltip.classList.remove('visible');
        alert(`An error occurred during validation: ${error.message}`);
    }
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

    function handleNodeClick(event, d) {
        event.stopPropagation();
        if (event.shiftKey && d.text && d.type !== 'add') return handleWordSubmitted(d.text, true);
        if (d.clusterId && d.clusterId !== currentActiveCentral) focusOnCentralNode(d.clusterId);
        if (d.isCentral) fetchMoreNodes();
        else if (d.type === 'add') handleAddWord();
        else if (d.type === 'translation') toggleTranslationExamples(d);
        else if (d.type === 'meaning' && !d.isUserAdded) toggleMeaningExamples(d);
    }

    function handleLabelClick(event, d) {
        event.stopPropagation();
        if (d.text) handleWordSubmitted(d.text, true);
    }
 
    function handleMouseOver(event, d) {
        let tooltipText = '';
        if (d.isCentral) {
            const cluster = graphClusters.get(d.clusterId);
            if (cluster) {
                const count = cluster.nodes.filter(n => n.type === cluster.currentView && !n.isUserAdded).length;
                tooltipText = `${count} of ${viewState.total || count} ${cluster.currentView} shown`;
            }
        } else if (d.type === 'add') tooltipText = 'Add new word';
        else if (d.text) tooltipText = `Shift+click to explore "${d.text}"`;
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
        centralNodes.forEach((node, index) => {
            const cluster = graphClusters.get(node.word);
            if (cluster) cluster.center = calculateClusterCenter(index);
        });
        if (centralNodes.length > 0) {
            simulation.force("center").x(width / 2).y(height / 2);
            simulation.alpha(0.3).restart();
        } else {
            renderInitialPrompt();
        }
    }

    function toggleMeaningExamples(meaningNode) {
        const cluster = graphClusters.get(meaningNode.clusterId);
        if (!cluster) return;
        const examplesShown = cluster.nodes.some(n => n.sourceMeaningId === meaningNode.id);
        if (examplesShown) {
            cluster.nodes = cluster.nodes.filter(n => n.sourceMeaningId !== meaningNode.id);
            cluster.links = cluster.links.filter(l => !l.target.sourceMeaningId || l.target.sourceMeaningId !== meaningNode.id);
        } else {
            if (meaningNode.examples) {
                meaningNode.examples.forEach((exText, i) => {
                    const exId = `${meaningNode.id}-ex-${i}`;
                    const exNode = { id: exId, text: exText, type: 'example', sourceMeaningId: meaningNode.id, clusterId: meaningNode.clusterId };
                    cluster.nodes.push(exNode);
                    cluster.links.push({ source: meaningNode.id, target: exId, type: 'example' });
                });
            }
        }
        detectCrossConnections();
        updateGraph();
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

    // --- CORRECTED SECTION: `fetchMoreNodes` ---
    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveCentral);
        if (!currentActiveCentral || !cluster || !viewState.hasMore) return;
        
        const centralNodeElement = graphGroup.selectAll('.central-node').filter(d => d.clusterId === currentActiveCentral);
        centralNodeElement.classed('loading', true);
        
        try {
            // CORRECT: Call the helper function instead of the old window.api method
            const data = await fetchData(currentActiveCentral, cluster.currentView, viewState.offset, 3);

            if (data.nodes.length > 0) {
                data.nodes.forEach(newNodeData => {
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
            // Optionally, show a temporary error message in the tooltip
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
        const isPaginatedView = currentView !== 'meaning'; // Example condition
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
        console.log('SVG String:', svgString.substring(0, 500) + '...');
        alert('Failed to save image. Please try again.');
    };
    
    image.src = svgDataUrl;
}

    function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
    function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
    function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

    // --- Initialization ---
    renderInitialPrompt();
    controlsDock.addEventListener('click', handleDockClick);
    zoomControls.addEventListener('click', handleZoomControlsClick);    
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