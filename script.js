// --- START OF FILE script.js ---

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// --- State Management ---
let currentRegister = 'conversational';
let currentProficiency = 'high';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Refs ---
    const languageModal = document.getElementById('language-modal');
    const languageList = document.getElementById('language-list');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const graphContainer = document.getElementById('graph-container');
    const controlsDock = document.getElementById('controls-dock');
    const zoomControls = document.getElementById('zoom-controls');
    const registerToggleBtn = document.getElementById('register-toggle-btn');
    const proficiencyToggleBtn = document.getElementById('proficiency-toggle-btn');

    if (registerToggleBtn) {
        registerToggleBtn.classList.add('needs-attention');
    }

    const tooltip = document.getElementById('graph-tooltip');
    const svg = d3.select("#wordsplainer-graph-svg");
    const graphGroup = svg.append("g");
    const iconGroup = svg.append("g").attr("class", "icon-layer");

    // --- Enhanced State Management ---
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let currentActiveCentral = null;
    let currentView = 'meaning';
    let viewState = { offset: 0, hasMore: true };

    function stopRegisterButtonAnimation() {
        if (registerToggleBtn) {
            registerToggleBtn.classList.remove('needs-attention');
        }
    }
    
    // --- Helper Functions ---
    function speak(text, lang = 'en-US') {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            utterance.pitch = 1;
            utterance.rate = 1;
            window.speechSynthesis.speak(utterance);
        } else {
            alert("Sorry, your browser does not support text-to-speech.");
        }
    }

    function copyToClipboard(text) {
        const cleanedText = text.split('\n\n(')[0];
        if (!navigator.clipboard) {
            alert("Sorry, your browser does not support the Clipboard API.");
            return;
        }
        navigator.clipboard.writeText(cleanedText).then(() => {
            tooltip.textContent = 'Copied to clipboard!';
            tooltip.classList.add('visible');
            setTimeout(() => { tooltip.classList.remove('visible'); }, 1500);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            tooltip.textContent = 'Copy failed!';
            tooltip.classList.add('visible');
            setTimeout(() => { tooltip.classList.remove('visible'); }, 1500);
        });
    }

    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
        try {
            console.log(`Fetching data: ${word}, ${type}, register: ${currentRegister}, proficiency: ${currentProficiency}`);
            const response = await fetch('/.netlify/functions/wordsplainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word: word,
                    type: type,
                    offset: offset,
                    limit: limit,
                    language: language,
                    register: currentRegister,
                    proficiency: currentProficiency
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
            return data;
        } catch (error) {
            console.error("fetchData error:", error);
            throw new Error(`Failed to fetch ${type} for "${word}": ${error.message}`);
        }
    }

    function forceCluster() {
        const strength = 0.2;
        return function(alpha) {
            const allNodes = getConsolidatedGraphData().nodes;
            for (let node of allNodes) {
                if (node.isCentral || !node.clusterId || !graphClusters.has(node.clusterId)) continue;
                const cluster = graphClusters.get(node.clusterId);
                const target = cluster.center;
                node.vx += (target.x - node.x) * strength * alpha;
                node.vy += (target.y - node.y) * strength * alpha;
            }
        };
    }

    function getCollisionRadius(d) {
        if (d.isCentral) return 60;
        if (d.width && d.height) return Math.sqrt(d.width * d.width + d.height * d.height) / 2 + 15;
        if (d.type === 'add') return 25;
        return 45;
    }

    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(d => d.target.type === 'example' ? 100 : 150).strength(0.7))
        .force("charge", d3.forceManyBody().strength(d => d.isCentral ? -1500 : -400).distanceMax(500))
        .force("collision", d3.forceCollide().radius(getCollisionRadius).strength(0.9))
        .force("cluster", forceCluster());

    const zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on("zoom", (event) => {
        graphGroup.attr("transform", event.transform);
        iconGroup.attr("transform", event.transform);
    });
    svg.call(zoomBehavior);

    simulation.on("tick", () => {
        graphGroup.selectAll('.link').attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
        iconGroup.selectAll('.icon-wrapper').attr("transform", d => {
            if (d.isCentral) return `translate(${d.x}, ${d.y + 45 + 15})`;
            if (d.type === 'example' && d.width && d.height) {
                const x = d.x + (d.width / 2) - 10;
                const y = d.y - (d.height / 2) + 10;
                return `translate(${x}, ${y})`;
            }
            return `translate(-1000, -1000)`; // Hide icon until position is known
        });
    });
    
    function updateGraph() {
        const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();
        const visibleNodes = allNodes.filter(n => n.visible !== false);
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const visibleLinks = allLinks.filter(l => visibleNodeIds.has(l.source.id || l.source) && visibleNodeIds.has(l.target.id || l.target));
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll(".status-text, .prompt-plus, .loading-spinner").remove();

        graphGroup.selectAll(".link").data(visibleLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`).join(
            enter => enter.append("line").attr("class", d => `link ${d.target.type === 'example' ? 'link-example' : ''}`).style("opacity", 0).style("stroke-width", 0)
                .transition().duration(800).delay((d, i) => i * 50).ease(d3.easeCircleOut).style("opacity", 1).style("stroke-width", d => d.type === 'cross-cluster' ? 2 : 1),
            update => update.attr("class", d => `link ${d.target.type === 'example' ? 'link-example' : ''}`),
            exit => exit.transition().duration(400).ease(d3.easeCircleIn).style("opacity", 0).style("stroke-width", 0).remove()
        );

        const nodeGroups = graphGroup.selectAll(".node").data(visibleNodes, d => d.id)
    .join(
        enter => enter.append("g")
            .style("opacity", 0)
            .attr("transform", d => {
                const cluster = graphClusters.get(d.clusterId);
                const startPos = cluster ? cluster.center : { x: width / 2, y: height / 2 };
                // Start new nodes from their cluster center and scaled down
                return `translate(${startPos.x},${startPos.y}) scale(0.1)`;
            })
            .call(g => g.transition().duration(600)
                .delay((d, i) => (d.isCentral ? 0 : d.type === 'add' ? visibleNodes.length * 30 : i * 80))
                .ease(d3.easeBackOut.overshoot(1.2))
                .style("opacity", 1)
                .attr("transform", d => `translate(${d.x || 0},${d.y || 0}) scale(1)`)
            ),
        update => update, // No special logic needed for update here
        exit => exit.transition().duration(400).ease(d3.easeCircleIn)
            .attr("transform", d => `translate(${d.x},${d.y}) scale(0)`)
            .style("opacity", 0)
            .remove()
    );

// Apply these attributes and event handlers to ALL nodes (both entering and updating)
nodeGroups
    .attr("class", d => `node ${d.isCentral ? `central-node ${d.clusterId === currentActiveCentral ? 'active-central' : ''}` : `node-${d.type}`}`)
    .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended).filter(event => !event.target.classList.contains('interactive-word')))
    .on("mouseover", handleMouseOver)
    .on("mouseout", handleMouseOut)
    .on("click", handleNodeClick);

// Now, populate the content for all nodes
nodeGroups.each(function(d) {
    const selection = d3.select(this);
    // Clear previous contents
    selection.selectAll("circle, rect, foreignObject, text").remove();

    if (d.isCentral) {
        selection.append("circle").attr("r", 45).style("filter", "drop-shadow(0 0 10px var(--primary-coral))");
        selection.append("text").attr("class", "node-text").text(d.word || d.id).attr("dy", "0.3em").style("font-weight", "bold").style("font-size", "16px");
    } else if (d.type === 'add') {
        selection.append("circle").attr("r", 20);
        selection.append("text").text('+').style("font-size", "24px").style("font-weight", "300").style("fill", "var(--primary-coral)");
    } else {
        const isExample = d.type === 'example';
        if (!isExample) selection.append("circle").attr("r", 18);

        const textWidth = isExample ? 220 : 200;
        const PADDING = isExample ? 0 : 12;
        const circleRadius = isExample ? 0 : 18;

        const foreignObject = selection.append("foreignObject")
            .attr("class", "node-html-wrapper")
            .attr("width", textWidth)
            .attr("x", isExample ? -textWidth / 2 : circleRadius + PADDING)
            .style("opacity", 0);

        const div = foreignObject.append("xhtml:div").attr("class", "node-html-content");
        createInteractiveText(div, d.text, (word) => handleWordSubmitted(word, true, d));

        setTimeout(() => {
            if (div.node()) {
                const textHeight = div.node().scrollHeight;
                foreignObject.attr("height", textHeight).attr("y", isExample ? -textHeight / 2 : -textHeight / 2);
                d.width = isExample ? textWidth : circleRadius * 2 + PADDING + textWidth;
                d.height = Math.max(circleRadius * 2, textHeight);
                foreignObject.transition().duration(400).style("opacity", 1);
                // Nudge the simulation to re-evaluate collisions with the new size
                simulation.alpha(0.1).restart();
            }
        }, 50); // Small delay to allow DOM to render for height calculation
        selection.style("cursor", "pointer");
    }
});

        const iconData = visibleNodes.filter(d => d.isCentral || d.type === 'example');
        iconGroup.selectAll('.icon-wrapper').data(iconData, d => d.id).join(
            enter => {
                const iconWrapper = enter.append('g').attr('class', 'icon-wrapper').style('opacity', 0);
                iconWrapper.filter(d => d.isCentral).append('g').attr('class', 'tts-icon-group').on('click', (event, d) => { speak(d.word); })
                    .append('svg').attr('class', 'tts-icon').attr('width', 24).attr('height', 24).attr('viewBox', '0 0 16 16')
                    .html(`<title>Read aloud</title><path d="M9 4a.5.5 0 0 0-.812-.39L5.825 5.5H3.5A.5.5 0 0 0 3 6v4a.5.5 0 0 0 .5.5h2.325l2.363 1.89A.5.5 0 0 0 9 12zM6.312 6.39 8 5.04v5.92L6.312 9.61A.5.5 0 0 0 6 9.5H4v-3h2a.5.5 0 0 0 .312-.11M12.025 8a4.5 4.5 0 0 1-1.318 3.182L10 10.475A3.5 3.5 0 0 0 11.025 8 3.5 3.5 0 0 0 10 5.525l.707-.707A4.5 4.5 0 0 1 12.025 8"/>`);
                iconWrapper.filter(d => d.type === 'example').append('g').attr('class', 'copy-icon-group').on('click', (event, d) => { copyToClipboard(d.text); })
                    .append('svg').attr('class', 'copy-icon').attr('width', 20).attr('height', 20).attr('viewBox', '0 0 16 16')
                    .html(`<title>Copy example</title><path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>`);
                return iconWrapper.transition().duration(600).delay(500).style('opacity', 1);
            },
            update => update,
            exit => exit.transition().duration(400).style('opacity', 0).remove()
        );

        graphGroup.selectAll(".link").style("stroke", d => d.type === 'cross-cluster' ? 'var(--accent-orange)' : d.target.type === 'example' ? 'var(--primary-coral)' : 'var(--text-secondary)').style("stroke-width", d => d.type === 'cross-cluster' ? 2 : d.target.type === 'example' ? 1.5 : 1).style("stroke-dasharray", d => d.type === 'cross-cluster' ? "8,4" : "none").style("opacity", d => d.target.type === 'example' ? 0.8 : 0.6);
        simulation.nodes(visibleNodes);
        simulation.force("link").links(visibleLinks);
        simulation.alpha(1).restart();
        graphGroup.selectAll('.central-node').raise();
        updateCentralNodeState();
    }
    
    function renderInitialPrompt() {
        simulation.stop();
        centralNodes = [];
        graphClusters.clear();
        crossConnections = [];
        currentActiveCentral = null;
        graphGroup.selectAll("*").remove();
        iconGroup.selectAll("*").remove();
        const { width, height } = graphContainer.getBoundingClientRect();
        const promptGroup = graphGroup.append("g").attr("class", "node central-node").style("cursor", "pointer").on("click", promptForInitialWord);
        promptGroup.append("circle").attr("cx", width / 2).attr("cy", height / 2).attr("r", 40);
        promptGroup.append("text").attr("class", "sub-text").attr("x", width / 2).attr("y", height / 2).attr("dy", "0.1em").text("+");
        promptGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 70).text("Add a word to explore");
    }

    // --- Event Handlers & Core Logic ---
    function refetchCurrentView() {
        if (currentActiveCentral) {
            console.log(`Settings changed. Re-fetching for '${currentActiveCentral}'.`);
            const cluster = graphClusters.get(currentActiveCentral);
            if (cluster) {
                cluster.nodes = cluster.nodes.filter(n => n.isCentral || n.type === 'add');
                const addNode = cluster.nodes.find(n => n.id === `add-${currentActiveCentral}`);
                cluster.links = addNode ? [{ source: `central-${currentActiveCentral}`, target: addNode.id }] : [];
                viewState = { offset: 0, hasMore: true };
                generateGraphForView(currentView);
            }
        }
    }

    function handleRegisterToggle() {
    stopRegisterButtonAnimation();
    const registers = ['conversational', 'academic', 'business'];
    const currentIndex = registers.indexOf(currentRegister);
    const nextIndex = (currentIndex + 1) % registers.length;
    currentRegister = registers[nextIndex];
    console.log(`Register is now: ${currentRegister}`); // For debugging
    registerToggleBtn.classList.remove('is-academic', 'is-business'); // Clear old state classes
    if (currentRegister === 'academic') {
        registerToggleBtn.classList.add('is-academic');
    } else if (currentRegister === 'business') {
        registerToggleBtn.classList.add('is-business');
    }
   
    refetchCurrentView();
}
    function handleProficiencyToggle() {
        currentProficiency = (currentProficiency === 'high') ? 'low' : 'high';
        proficiencyToggleBtn.classList.toggle('is-high', currentProficiency === 'high');
        refetchCurrentView();
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
    
    async function handleWordSubmitted(word, isNewCentral = true, sourceNode = null) {
        const lowerWord = word.toLowerCase();
        
        if (isNewCentral) {
            if (centralNodes.some(c => c.word === lowerWord)) {
                const existingNode = centralNodes.find(n => n.word === lowerWord);
                if(existingNode) focusOnCentralNode(existingNode.clusterId);
                return;
            }

            const centralNodeData = { 
                word: lowerWord, id: `central-${lowerWord}`, 
                isCentral: true, type: 'central', clusterId: lowerWord,
                visible: true
            };
            
            centralNodes.push(centralNodeData);
            graphClusters.set(lowerWord, { 
                nodes: [centralNodeData], 
                links: [], 
                center: { x: 0, y: 0 }, 
                currentView: 'meaning' 
            });

            const newClusterCenter = repositionAllClusters();
            
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

    function panToNode(target, scale = 1.2) {
        if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
            console.error("panToNode called with invalid target:", target);
            return;
        }
        
        const { width, height } = graphContainer.getBoundingClientRect();
        
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-target.x, -target.y);
        
        svg.transition()
            .duration(1000)
            .ease(d3.easeCubicInOut)
            .call(zoomBehavior.transform, transform);
    }
    
    function renderLoading(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();
        iconGroup.selectAll("*").remove();
        
        const loadingGroup = graphGroup.append("g");
        loadingGroup.append("circle").attr("class", "loading-spinner").attr("cx", width / 2).attr("cy", height / 2 - 30).attr("r", 20).attr("fill", "none").attr("stroke", "var(--primary-coral)").attr("stroke-width", 3).attr("stroke-dasharray", "31.4, 31.4");
        loadingGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 30).text(message);
    }

    function renderError(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll("*").remove();
        iconGroup.selectAll("*").remove();
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
                    proficiency: currentProficiency,
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
        cluster.currentView = view;
        currentView = view;
        updateActiveButton();
        if (alreadyLoaded) {
            console.log(`CACHE HIT for "${currentActiveCentral}" - view: ${view}`);
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
        renderLoading(`Loading ${view} for "${currentActiveCentral}"...`);
        try {
            const data = await fetchData(currentActiveCentral, view, 0, view === 'meaning' ? 1 : 5, options.language);
            if (!data || !data.nodes) throw new Error("No data received from server.");
            data.nodes.forEach(nodeData => {
                if (!nodeData || typeof nodeData.text !== 'string') return;
                const nodeId = `${currentActiveCentral}-${nodeData.text.slice(0, 10)}-${view}`;
                if (cluster.nodes.some(n => n.id === nodeId)) return;
                const newNode = { ...nodeData, id: nodeId, type: view, clusterId: currentActiveCentral, visible: true, lang: options.language };
                cluster.nodes.push(newNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNode.id });
            });
            if (!cluster.nodes.some(n => n.id === `add-${currentActiveCentral}`)) {
                const addNode = { id: `add-${currentActiveCentral}`, type: 'add', clusterId: currentActiveCentral, visible: true };
                cluster.nodes.push(addNode);
                cluster.links.push({ source: `central-${currentActiveCentral}`, target: addNode.id });
            }
            cluster.nodes.forEach(node => {
                const isExample = node.type === 'example';
                if (!isExample) {
                    node.visible = node.isCentral || node.type === 'add' || node.type === currentView;
                } else {
                    const sourceNode = cluster.nodes.find(n => n.id === node.sourceNodeId);
                    node.visible = sourceNode ? sourceNode.visible : false;
                }
            });
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
            generateGraphForView(dataType);
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
            if (lineIndex > 0 && !isSvg) d3Element.append("br");
            const tokens = line.split(/(\s+|[.,!?;:"])/g).filter(t => t);
            const lineContainer = isSvg ? d3Element.append('tspan').attr('x', 0).attr('dy', lineIndex === 0 ? '0.3em' : '1.4em') : d3Element;
            tokens.forEach(token => {
                const cleanedToken = token.trim().toLowerCase().replace(/[.,!?;:"]+/g, '');
                if (cleanedToken.length > 1 && /^[a-z']+$/.test(cleanedToken)) {
                    lineContainer.append('span').attr('class', 'interactive-word').text(token).on('click', (event) => { event.stopPropagation(); if(token) onWordClick(token); });
                } else {
                    lineContainer.append('span').text(token);
                }
            });
        });
    }

    const CLUSTER_SPACING = 700;
    function repositionAllClusters() {
        if (centralNodes.length === 0) return null;
        const { width, height } = graphContainer.getBoundingClientRect();
        const currentTransform = d3.zoomTransform(svg.node());
        const viewCenterX = (width / 2 - currentTransform.x) / currentTransform.k;
        const viewCenterY = (height / 2 - currentTransform.y) / currentTransform.k;
        const lastNodeIndex = centralNodes.length - 1;
        let lastNodeCenter = null;
        centralNodes.forEach((node, i) => {
            const cluster = graphClusters.get(node.clusterId);
            if (cluster) {
                const targetX = viewCenterX - ((lastNodeIndex - i) * CLUSTER_SPACING);
                const targetY = viewCenterY;
                node.fx = targetX;
                node.fy = targetY;
                cluster.center.x = targetX;
                cluster.center.y = targetY;
                if (i === lastNodeIndex) lastNodeCenter = { x: targetX, y: targetY };
            }
        });
        simulation.alpha(0.5).restart();
        return lastNodeCenter;
    }

    function handleResize() {
        const { width, height } = graphContainer.getBoundingClientRect();
        svg.attr("width", width).attr("height", height);
        if (centralNodes.length > 0) {
            repositionAllClusters();
        } else {
            renderInitialPrompt();
        }
    }

    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveCentral);
        if (!currentActiveCentral || !cluster || !viewState.hasMore) return;
        const addNodeElement = graphGroup.selectAll('.node-add').filter(node_d => node_d.clusterId === currentActiveCentral);
        if (addNodeElement.classed('is-loading')) return;
        addNodeElement.classed('is-loading', true);
        try {
            const data = await fetchData(currentActiveCentral, cluster.currentView, viewState.offset, 3);
            if (data.nodes.length > 0) {
                let addedNodeCount = 0;
                data.nodes.forEach(newNodeData => {
                    if (!newNodeData || typeof newNodeData.text !== 'string') return;
                    const isDuplicate = cluster.nodes.some(existingNode => existingNode.text && existingNode.text.toLowerCase() === newNodeData.text.toLowerCase());
                    if (!isDuplicate) {
                        const newNodeId = `${currentActiveCentral}-${newNodeData.text.slice(0, 10)}-${cluster.currentView}`;
                        const newNode = { ...newNodeData, id: newNodeId, type: cluster.currentView, clusterId: currentActiveCentral, visible: true };
                        cluster.nodes.push(newNode);
                        cluster.links.push({ source: `central-${currentActiveCentral}`, target: newNodeId });
                        addedNodeCount++;
                    } else {
                        console.log(`Skipping duplicate node: "${newNodeData.text}"`);
                    }
                });
                if (addedNodeCount > 0) {
                    detectCrossConnections();
                    updateGraph();
                }
                viewState.offset += data.nodes.length;
                viewState.hasMore = data.hasMore;
            } else {
                viewState.hasMore = false;
            }
        } catch (error) {
            console.error("Failed to fetch more nodes:", error);
            tooltip.textContent = "Error loading.";
            tooltip.classList.add('visible');
            setTimeout(() => tooltip.classList.remove('visible'), 2000);
        } finally {
            addNodeElement.classed('is-loading', false);
            if (!viewState.hasMore) addNodeElement.classed('is-disabled', true);
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
        if (centralNodes.length === 0) {
            alert("Nothing to save yet!");
            return;
        }
        const allNodes = getConsolidatedGraphData().nodes;
        if (allNodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        allNodes.forEach(d => {
            const nodeWidth = d.width || (d.isCentral ? 90 : 40);
            const nodeHeight = d.height || (d.isCentral ? 90 : 40);
            minX = Math.min(minX, d.x - nodeWidth / 2);
            maxX = Math.max(maxX, d.x + nodeWidth / 2);
            minY = Math.min(minY, d.y - nodeHeight / 2);
            maxY = Math.max(maxY, d.y + nodeHeight / 2);
        });
        const padding = 100;
        const exportWidth = (maxX - minX) + 2 * padding;
        const exportHeight = (maxY - minY) + 2 * padding;
        const tempSvg = d3.create('svg').attr('xmlns', 'http://www.w3.org/2000/svg').attr('width', exportWidth).attr('height', exportHeight).attr('viewBox', `0 0 ${exportWidth} ${exportHeight}`);
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        tempSvg.attr('data-theme', currentTheme);
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
        tempSvg.append('rect').attr('width', '100%').attr('height', '100%').attr('fill', bgColor);
        const creditTextColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
        tempSvg.append('text').attr('x', exportWidth / 2).attr('y', exportHeight - 20).attr('text-anchor', 'middle').attr('font-family', 'Inter, sans-serif').attr('font-size', '14px').attr('fill', creditTextColor).text('Wordsplainer, www.eltcation.com');
        const tempGroup = tempSvg.append('g').attr('transform', `translate(${-minX + padding}, ${-minY + padding})`);
        const style = tempSvg.append('style');
        let cssText = "";
        for (const sheet of document.styleSheets) {
            try { if (sheet.cssRules) for (const rule of sheet.cssRules) cssText += rule.cssText + '\n'; } catch (e) { console.warn("Cannot read CSS rules from stylesheet: " + e); }
        }
        style.text(cssText);
        graphGroup.selectAll('.link').each(function() { tempGroup.node().appendChild(this.cloneNode(true)); });
        graphGroup.selectAll('.node').each(function() { tempGroup.node().appendChild(this.cloneNode(true)); });
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
        image.onerror = (e) => { console.error('Failed to load SVG into image:', e); alert('An error occurred while creating the image. Please check the console.'); };
    }

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.isCentral ? d.fx : d.x;
        d.fy = d.isCentral ? d.fy : d.y;
    }

    function dragged(event, d) {
        if (!d.isCentral) { d.fx = event.x; d.fy = event.y; }
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        if (!d.isCentral) { d.fx = null; d.fy = null; }
    }

    // --- Initialization ---
    renderInitialPrompt();
    controlsDock.addEventListener('click', handleDockClick);
    zoomControls.addEventListener('click', handleZoomControlsClick);
    registerToggleBtn.addEventListener('click', handleRegisterToggle);
    proficiencyToggleBtn.addEventListener('click', handleProficiencyToggle);
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