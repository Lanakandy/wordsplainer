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
    const SNAP_OFF_THRESHOLD = 120;

    // --- Enhanced State Management ---
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let explorationHistory = [];
    let currentActiveCentral = null;
    let clusterColors = d3.scaleOrdinal(d3.schemeCategory10);
    
    let currentView = 'meaning';
    let viewState = { offset: 0, hasMore: true };

    // --- Central API fetching function ---
    async function fetchData(word, type, offset = 0, limit = 3, language = null) {
        const response = await fetch('/.netlify/functions/wordsplainer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word: word,
                type: type,
                offset: offset,
                limit: limit,
                language: language
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

        graphGroup.selectAll(".link")
            .data(allLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
            .join(
                enter => enter.append("line")
                    .attr("class", d => `link ${d.type === 'example' ? 'link-example' : ''}`)
                    .style("opacity", 0)
                    .transition().duration(600).delay(200)
                    .style("opacity", 1),
                update => update,
                exit => exit.transition().duration(300)
                    .style("opacity", 0)
                    .remove()
            );

        graphGroup.selectAll(".node")
            .data(allNodes, d => d.id)
            // ... inside updateGraph ...
.join(
    enter => {
        const nodeGroup = enter.append("g")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended)
                .filter(event => !event.target.classList.contains('interactive-word'))
            )
            // ATTACH ALL HANDLERS TO THE GROUP FOR A CONSISTENT HIT AREA
            .on("mouseover", handleMouseOver) // Added back the missing mouseover
            .on("mouseout", handleMouseOut)
            .on("click", handleNodeClick) // <-- CLICK IS NOW ON THE GROUP
            .attr("transform", d => `translate(${d.x || width / 2}, ${d.y || height / 2})`);

        // The shape now has NO event listeners. It's just for visuals.
        nodeGroup.append(d => (d.type === 'example') ? document.createElementNS(d3.namespaces.svg, 'rect') : document.createElementNS(d3.namespaces.svg, 'circle'));

        nodeGroup.select("circle")
            .attr("r", 0)
            .transition()
            .duration(400)
            .ease(d3.easeElasticOut.amplitude(1).period(0.5))
            .attr("r", d => d.isCentral ? 40 : 15);
        
        nodeGroup.select("rect").style("opacity", 0);

        // The text element also has NO event listeners.
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
                    textElement.attr("class", "node-text").text(d.word || d.id).attr("dy", "0.3em");
                    if (d.phonetic) {
                        selection.append("text")
                            .attr("class", "phonetic-text")
                            .attr("dy", "1.5em")
                            .style("font-size", "12px")
                            .style("fill", "var(--text-secondary)")
                            .text(d.phonetic);
                    }
                } else if (d.type === 'add') {
                    textElement.text('+').style("font-size", "24px").style("font-weight", "300").style("fill", "white").style("stroke", "none");
                    const cluster = graphClusters.get(d.clusterId);
                    if (cluster) {
                        const singularView = cluster.currentView.endsWith('s') ? cluster.currentView.slice(0, -1) : cluster.currentView;
                        selection.select('circle').style("fill", `var(--${singularView}-color)`);
                    }
                } else if (d.type === 'example') {
    selection.select("rect").attr("class", "example-bg"); 
    createInteractiveText(textElement, d.text, (word) => handleWordSubmitted(word, true));
    setTimeout(() => {
        const bbox = textElement.node()?.getBBox();
        if (bbox) {
            selection.select("rect")
                .attr("width", bbox.width + 20)
                .attr("height", bbox.height + 10)
                .attr("x", bbox.x - 10)
                .attr("y", bbox.y - 5)
                .transition().duration(200).style("opacity", 1);
        }
    }, 0);
} else {
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
            const body = {
                type: 'generateExample',
                word: nodeData.text,
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
    } else if (d.type === 'meaning') {
        toggleMeaningExamples(d);
    }
}

// Enhanced createInteractiveText function with better word detection and UX
function createInteractiveText(d3TextElement, text, onWordClick, sourceNodeData) {
    d3TextElement.selectAll("tspan").remove(); // Clear previous content

    // Enhanced word detection - includes contractions, hyphenated words, etc.
    const WORD_PATTERN = /\b[a-zA-Z]+(?:[''][a-zA-Z]+)*(?:-[a-zA-Z]+)*\b/g;
    
    // Split text into lines first
    const lines = text.split('\n');
    
    lines.forEach((line, lineIndex) => {
        // More sophisticated tokenization that preserves word boundaries
        const tokens = [];
        let lastIndex = 0;
        
        // Find all words and their positions
        const wordMatches = [...line.matchAll(WORD_PATTERN)];
        
        wordMatches.forEach(match => {
            // Add any text before this word
            if (match.index > lastIndex) {
                tokens.push({
                    text: line.slice(lastIndex, match.index),
                    type: 'punctuation'
                });
            }
            
            // Add the word
            tokens.push({
                text: match[0],
                type: 'word',
                cleanWord: match[0].toLowerCase().replace(/['']s?$/, '') // Remove possessive
            });
            
            lastIndex = match.index + match[0].length;
        });
        
        // Add any remaining text
        if (lastIndex < line.length) {
            tokens.push({
                text: line.slice(lastIndex),
                type: 'punctuation'
            });
        }

        const lineTspan = d3TextElement.append('tspan')
            .attr('x', 10)
            .attr('dy', lineIndex === 0 ? 0 : '1.2em');

        tokens.forEach(token => {
            if (token.type === 'word') {
                // Skip very common words that aren't useful for exploration
                const isCommonWord = isVeryCommonWord(token.cleanWord);
                const isSourceWord = token.cleanWord === sourceNodeData?.text?.toLowerCase();
                
                const wordTspan = lineTspan.append('tspan')
                    .attr('class', `interactive-word ${isCommonWord ? 'common-word' : 'explorable-word'} ${isSourceWord ? 'source-word' : ''}`)
                    .text(token.text);
                
                if (!isCommonWord) {
                    wordTspan
                        .style('cursor', 'pointer')
                        .on('click', (event) => {
                            event.stopPropagation();
                            handleWordClickWithFeedback(token.cleanWord, event.target, onWordClick);
                        })
                        .on('mouseover', (event) => {
                            showWordPreview(event, token.cleanWord);
                        })
                        .on('mouseout', hideWordPreview);
                } else {
                    // Add subtle styling for common words
                    wordTspan.style('opacity', '0.7');
                }
            } else {
                // Append non-clickable parts (spaces, punctuation)
                lineTspan.append('tspan').text(token.text);
            }
        });
    });
}

// Enhanced word click handler with visual feedback
function handleWordClickWithFeedback(word, targetElement, onWordClick) {
    // Visual feedback for the clicked word
    const wordElement = d3.select(targetElement);
    
    // Add loading state
    wordElement.classed('word-loading', true);
    
    // Add ripple effect
    createRippleEffect(targetElement);
    
    // Call the original handler
    onWordClick(word);
    
    // Remove loading state after a short delay
    setTimeout(() => {
        wordElement.classed('word-loading', false);
    }, 800);
}

// Create visual ripple effect for word clicks
function createRippleEffect(element) {
    const rect = element.getBoundingClientRect();
    const ripple = document.createElement('div');
    ripple.className = 'word-ripple';
    ripple.style.cssText = `
        position: absolute;
        left: ${rect.left + rect.width/2}px;
        top: ${rect.top + rect.height/2}px;
        width: 0;
        height: 0;
        border-radius: 50%;
        background: var(--primary-coral);
        opacity: 0.6;
        pointer-events: none;
        z-index: 1000;
        animation: ripple 0.6s ease-out;
    `;
    
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

// Helper function to identify very common words
function isVeryCommonWord(word) {
    const commonWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
        'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'among', 'is', 'are', 
        'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
        'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 
        'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 
        'these', 'those', 'here', 'there', 'where', 'when', 'why', 'how', 'what',
        'who', 'which', 'whose', 'whom'
    ]);
    return commonWords.has(word.toLowerCase());
}

// Word preview tooltip system
let wordPreviewTimeout;
const wordPreviewTooltip = createWordPreviewTooltip();

function createWordPreviewTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'word-preview-tooltip';
    tooltip.style.cssText = `
        position: absolute;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--text-secondary);
        pointer-events: none;
        z-index: 1001;
        opacity: 0;
        transform: translateY(-5px);
        transition: opacity 0.2s, transform 0.2s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    `;
    document.body.appendChild(tooltip);
    return tooltip;
}

function showWordPreview(event, word) {
    clearTimeout(wordPreviewTimeout);
    
    wordPreviewTimeout = setTimeout(() => {
        wordPreviewTooltip.textContent = `Click to explore "${word}"`;
        wordPreviewTooltip.style.left = `${event.pageX + 10}px`;
        wordPreviewTooltip.style.top = `${event.pageY - 35}px`;
        wordPreviewTooltip.style.opacity = '1';
        wordPreviewTooltip.style.transform = 'translateY(0)';
    }, 300); // Delay to avoid showing on quick mouse movements
}

function hideWordPreview() {
    clearTimeout(wordPreviewTimeout);
    wordPreviewTooltip.style.opacity = '0';
    wordPreviewTooltip.style.transform = 'translateY(-5px)';
}

// Enhanced example generation with context awareness
async function toggleExampleForNode(nodeData) {
    const cluster = graphClusters.get(nodeData.clusterId);
    if (!cluster) return;

    const existingExample = cluster.nodes.find(n => n.sourceNodeId === nodeData.id);

    if (existingExample) {
        // Remove existing example
        cluster.nodes = cluster.nodes.filter(n => n.id !== existingExample.id);
        cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== existingExample.id);
        updateGraph();
    } else {
        // Generate new example with enhanced context
        try {
            // Show loading state on the node
            const nodeElement = graphGroup.selectAll('.node').filter(d => d.id === nodeData.id);
            nodeElement.classed('generating-example', true);

            const body = {
                type: 'generateExample',
                word: nodeData.text,
                difficulty: 'intermediate', // Could be user-configurable
                contextType: nodeData.type, // synonyms, opposites, etc.
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
                throw new Error('Failed to generate example');
            }

            const data = await response.json();

            if (data.example) {
                const exId = `${nodeData.id}-ex`;
                const exNode = {
                    id: exId,
                    text: data.example,
                    type: 'example',
                    sourceNodeId: nodeData.id,
                    clusterId: nodeData.clusterId,
                    sourceWord: nodeData.text, // Store for highlighting
                    difficulty: data.difficulty || 'intermediate'
                };
                
                cluster.nodes.push(exNode);
                cluster.links.push({ 
                    source: nodeData.id, 
                    target: exId, 
                    type: 'example' 
                });
                
                updateGraph();
                
                // Auto-scroll to show the new example
                setTimeout(() => {
                    const exampleNode = graphGroup.selectAll('.node').filter(d => d.id === exId);
                    if (!exampleNode.empty()) {
                        const exampleData = exampleNode.datum();
                        highlightNewExample(exampleData);
                    }
                }, 100);
            }
        } catch (error) {
            console.error("Error generating example:", error);
            showErrorFeedback(nodeData.id, `Could not generate example: ${error.message}`);
        } finally {
            // Remove loading state
            const nodeElement = graphGroup.selectAll('.node').filter(d => d.id === nodeData.id);
            nodeElement.classed('generating-example', false);
        }
    }
}

// Highlight newly created examples
function highlightNewExample(exampleData) {
    const exampleElement = graphGroup.selectAll('.node').filter(d => d.id === exampleData.id);
    
    exampleElement
        .classed('new-example', true)
        .transition()
        .duration(2000)
        .ease(d3.easeLinear)
        .on('end', function() {
            d3.select(this).classed('new-example', false);
        });
}

// Enhanced error feedback system
function showErrorFeedback(nodeId, message) {
    const nodeElement = graphGroup.selectAll('.node').filter(d => d.id === nodeId);
    
    // Create temporary error indicator
    const errorIndicator = nodeElement.append('circle')
        .attr('class', 'error-indicator')
        .attr('r', 0)
        .style('fill', 'var(--error-color)')
        .style('opacity', 0.8);
    
    errorIndicator
        .transition()
        .duration(200)
        .attr('r', 25)
        .transition()
        .duration(200)
        .attr('r', 20)
        .transition()
        .delay(1000)
        .duration(300)
        .style('opacity', 0)
        .remove();
    
    // Show error message in tooltip
    tooltip.textContent = message;
    tooltip.classList.add('visible', 'error');
    setTimeout(() => {
        tooltip.classList.remove('visible', 'error');
    }, 3000);
}

// Update the main handleNodeClick function
function handleNodeClick(event, d) {
    event.stopPropagation();
    
    // Add click feedback for all interactive nodes
    if (d.type !== 'example') {
        const nodeElement = d3.select(event.currentTarget);
        nodeElement.classed('node-clicked', true);
        setTimeout(() => nodeElement.classed('node-clicked', false), 200);
    }
    
    const exampleTypes = ['synonyms', 'opposites', 'derivatives', 'collocations', 'idioms', 'context'];

    if (exampleTypes.includes(d.type)) {
        return toggleExampleForNode(d);
    }

    if (d.isCentral) {
        focusOnCentralNode(d.clusterId);
    } else if (d.type === 'add') {
        fetchMoreNodes();
    } else if (d.type === 'translation') {
        toggleTranslationExamples(d);
    } else if (d.type === 'meaning') {
        toggleMeaningExamples(d);
    }
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

    // Remove the visual feedback class
    d3.select(event.sourceEvent.target.parentNode).classed('node-detaching', false);

    const distance = Math.sqrt(Math.pow(d.fx - d.startX, 2) + Math.pow(d.fy - d.startY, 2));

    // If it's not a central node and was dragged past the threshold...
    if (!d.isCentral && d.text && distance > SNAP_OFF_THRESHOLD) {
        // --- This is the "Snap Off" logic ---
        
        // 1. Find the cluster this node belongs to.
        const cluster = graphClusters.get(d.clusterId);
        if (cluster) {
            // 2. Remove the old node from its original cluster's data.
            cluster.nodes = cluster.nodes.filter(n => n.id !== d.id);
            // 3. Remove the link that connected it.
            cluster.links = cluster.links.filter(l => (l.target.id || l.target) !== d.id);
        }
        
        // 4. Create the new graph with the detached node's word as the new central word.
        handleWordSubmitted(d.text, true);

    } else {
        // --- This is a normal drag (just repositioning) ---
        d.fx = null;
        d.fy = null;
    }
}

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