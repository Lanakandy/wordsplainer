// --- START OF FILE script.js ---

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Remove localStorage usage as per Claude.ai restrictions
    // localStorage.setItem('theme', theme);
}

// Check for saved theme without localStorage
// const savedTheme = localStorage.getItem('theme') || 'light';
const savedTheme = 'light'; // Default theme
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
    let clusterIdCounter = 0;
    let centralNodes = [];
    let graphClusters = new Map();
    let crossConnections = [];
    let currentActiveCentralWord = null;
    let currentActiveClusterId = null;
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

    function forceCluster() {
        const strength = 0.2;
        return function(alpha) {
            const allNodes = getConsolidatedGraphData().nodes;
            for (let node of allNodes) {
                if (node.isCentral || !node.clusterId || !graphClusters.has(node.clusterId)) {
                    continue;
                }
                const cluster = graphClusters.get(node.clusterId);
                if (!cluster || !cluster.center) continue;
                const target = cluster.center;
                if (typeof target.x === 'number' && typeof target.y === 'number') {
                    node.vx += (target.x - node.x) * strength * alpha;
                    node.vy += (target.y - node.y) * strength * alpha;
                }
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
        .force("link", d3.forceLink().id(d => d.id).distance(150).strength(0.7))
        .force("charge", d3.forceManyBody().strength(d => d.isCentral ? -1500 : -400).distanceMax(500))
        .force("collision", d3.forceCollide().radius(getCollisionRadius).strength(0.9))
        .force("cluster", forceCluster());

    function updateGraph() {
        const { nodes: allNodes, links: allLinks } = getConsolidatedGraphData();

        const visibleNodes = allNodes.filter(n => n.visible !== false);
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const visibleLinks = allLinks.filter(l => {
            const sourceId = l.source?.id || l.source;
            const targetId = l.target?.id || l.target;
            return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
        });
        
        const { width, height } = graphContainer.getBoundingClientRect();
        graphGroup.selectAll(".status-text").remove();

        // Links
        graphGroup.selectAll(".link")
            .data(visibleLinks, d => `${d.source?.id || d.source}-${d.target?.id || d.target}`)
            .join("line")
            .attr("class", "link");

        // Nodes
        const nodeGroups = graphGroup.selectAll(".node")
            .data(visibleNodes, d => d.id)
            .join(
                enter => {
                    const nodeGroup = enter.append("g")
                        .attr("class", d => `node ${d.isCentral ? 'central-node' : `node-${d.type}`}`)
                        .style("opacity", 0)
                        .attr("transform", d => `translate(${d.x || width/2},${d.y || height/2}) scale(0.1)`)
                        .call(d3.drag()
                            .on("start", dragstarted)
                            .on("drag", dragged)
                            .on("end", dragended)
                            .filter(event => !event.target.classList.contains('interactive-word'))
                        )
                        .on("mouseover", handleMouseOver)
                        .on("mouseout", handleMouseOut)
                        .on("click", handleNodeClick);

                    nodeGroup.transition().duration(600).ease(d3.easeBackOut.overshoot(1.2))
                        .style("opacity", 1)
                        .attr("transform", d => `translate(${d.x || width/2},${d.y || height/2}) scale(1)`);
                    
                    return nodeGroup;
                }
            );

        nodeGroups.each(function(d) {
            const selection = d3.select(this);
            selection.selectAll("circle, rect, foreignObject, text").remove();

            if (d.isCentral) {
                selection.append("circle").attr("r", 45).style("filter", "drop-shadow(0 0 10px var(--primary-coral))");
                selection.append("text").attr("class", "node-text").text(d.word).style("font-weight", "bold").style("font-size", "16px").attr("dy", "-0.2em");
                selection.append("text").attr("class", "node-text-small").text(d.view).style("font-size", "10px").style("text-transform", "uppercase").style("opacity", 0.8).attr("dy", "1em");
            } else if (d.type === 'add') {
                selection.append("circle").attr("r", 20);
                selection.append("text").text('+').style("font-size", "24px").style("font-weight", "300").style("fill", "var(--primary-coral)");
            } else {
                const isExample = d.type === 'example';
                if (!isExample) {
                    selection.append("circle").attr("r", 18);
                }
                const textWidth = isExample ? 220 : 200;
                const PADDING = 12;
                const circleRadius = 18;
                const foreignObject = selection.append("foreignObject").attr("class", "node-html-wrapper").attr("width", textWidth).attr("x", isExample ? -textWidth / 2 : circleRadius + PADDING).style("opacity", 0);
                const div = foreignObject.append("xhtml:div").attr("class", "node-html-content");
                createInteractiveText(div, d.text || '', (word) => createNewGraph(word, 'meaning'));
                setTimeout(() => {
                    if (div.node()) {
                        const textHeight = div.node().scrollHeight;
                        foreignObject.attr("height", textHeight).attr("y", -textHeight / 2);
                        d.width = isExample ? textWidth : circleRadius * 2 + PADDING + textWidth;
                        d.height = Math.max(circleRadius * 2, textHeight);
                        foreignObject.transition().duration(400).style("opacity", 1);
                        simulation.alpha(0.1).restart();
                    }
                }, 50);
            }
        });

        // Ensure the simulation has the full node objects, not just IDs
        simulation.nodes(visibleNodes);
        simulation.force("link").links(visibleLinks);
        simulation.alpha(1).restart();
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
        svg.transition().duration(1000).ease(d3.easeCubicInOut).call(zoomBehavior.transform, transform);
    }
    
    async function createNewGraph(word, view, options = {}) {
        if (!word || typeof word !== 'string') {
            console.error("Invalid word provided to createNewGraph:", word);
            return;
        }
        
        stopRegisterButtonAnimation();
        
        clusterIdCounter++;
        const clusterId = clusterIdCounter;
        currentActiveCentralWord = word;
        currentActiveClusterId = clusterId;
        currentView = view;
        viewState = { offset: 0, hasMore: true };
    
        const { width, height } = graphContainer.getBoundingClientRect();
        const centralNodeData = {
            word: word, 
            view: view, 
            id: `central-${clusterId}`,
            isCentral: true, 
            type: 'central', 
            clusterId: clusterId, 
            visible: true,
            x: width / 2,
            y: height / 2
        };
    
        centralNodes.push(centralNodeData);
        graphClusters.set(clusterId, {
            nodes: [centralNodeData], 
            links: [], 
            center: { x: width / 2, y: height / 2 }, 
            currentView: view
        });
    
        const newClusterCenter = repositionAllClusters();
        if (newClusterCenter) {
            panToNode(newClusterCenter, 1.2);
        }
        updateActiveButton();
        
        renderLoading(`Loading ${view} for "${word}"...`);

        try {
            const limit = view === 'meaning' ? 1 : 5;
            const data = await fetchData(word, view, 0, limit, options.language);

            graphGroup.selectAll(".status-text").remove();
    
            if (!data || !data.nodes || data.nodes.length === 0) {
                console.warn(`No data received for ${word} - ${view}`);
                updateGraph(); // Render the central node even if no children
                return;
            }
            
            const cluster = graphClusters.get(clusterId);
            if (!cluster) return;
    
            data.nodes.forEach(nodeData => {
                const nodeId = `${clusterId}-${(nodeData.text || '').slice(0, 10)}-${view}`;
                const newNode = { 
                    ...nodeData, 
                    id: nodeId, 
                    type: view, 
                    clusterId: clusterId, 
                    visible: true, 
                    lang: options.language,
                    x: centralNodeData.x + Math.random() * 100 - 50,
                    y: centralNodeData.y + Math.random() * 100 - 50
                };
                cluster.nodes.push(newNode);
                cluster.links.push({ source: centralNodeData.id, target: newNode.id });
            });
            
            const addNode = { 
                id: `add-${clusterId}`, 
                type: 'add', 
                clusterId: clusterId, 
                visible: true,
                x: centralNodeData.x + Math.random() * 100 - 50,
                y: centralNodeData.y + Math.random() * 100 - 50
            };
            cluster.nodes.push(addNode);
            cluster.links.push({ source: centralNodeData.id, target: addNode.id });
    
            detectCrossConnections();
            updateGraph();
    
        } catch (error) {
            console.error(`Error creating graph for ${word} - ${view}:`, error);
            renderError(`Error: ${error.message}`);
        }
    }

    function handleMouseOver(event, d) {
        const selection = d3.select(event.currentTarget);
        if (d.type !== 'add') {
            selection.transition().duration(200).attr("transform", `translate(${d.x || 0},${d.y || 0}) scale(1.1)`);
        }
        let tooltipText = '';
        if (d.isCentral) {
            tooltipText = `Exploring: ${d.view} • Click to focus`;
        } else if (d.type === 'add') {
            tooltipText = d3.select(event.currentTarget).classed('is-disabled') ? 'No more items' : `Load more ${graphClusters.get(d.clusterId)?.currentView || 'items'}`;
        } else if (d.text && !d.isCentral) {
            tooltipText = `Click circle for an example\nClick text to explore`;
        }
        if (tooltipText && tooltip) {
            tooltip.textContent = tooltipText;
            tooltip.classList.add('visible');
            tooltip.style.transform = 'translateY(-10px)';
        }
        if (tooltip) {
            svg.on('mousemove.tooltip', (e) => {
                tooltip.style.left = `${e.pageX + 15}px`;
                tooltip.style.top = `${e.pageY - 30}px`;
            });
        }
    }

    function handleMouseOut(event, d) {
        const selection = d3.select(event.currentTarget);
        if (d.type !== 'add') {
            selection.transition().duration(200).attr("transform", `translate(${d.x || 0},${d.y || 0}) scale(1)`);
        }
        if (tooltip) {
            tooltip.classList.remove('visible');
        }
        svg.on('mousemove.tooltip', null);
    }

    function handleNodeClick(event, d) {
        if (event.defaultPrevented) return;
        event.stopPropagation();
        
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

    function renderInitialPrompt() {
        simulation.stop();
        centralNodes = [];
        graphClusters.clear();
        crossConnections = [];
        currentActiveCentralWord = null;
        currentActiveClusterId = null;
        graphGroup.selectAll("*").remove();
        
        const { width, height } = graphContainer.getBoundingClientRect();
        const promptGroup = graphGroup.append("g").attr("class", "node central-node").style("cursor", "pointer").on("click", promptForInitialWord);
        promptGroup.append("circle").attr("cx", width / 2).attr("cy", height / 2).attr("r", 40);
        promptGroup.append("text").attr("class", "sub-text").attr("x", width / 2).attr("y", height / 2).attr("dy", "0.1em").text("+");
        promptGroup.append("text").attr("class", "status-text").attr("x", width / 2).attr("y", height / 2 + 70).text("Add a word to explore");
    }
    
    function renderLoading(message) {
        const { width, height } = graphContainer.getBoundingClientRect();
        const loadingGroup = graphGroup.selectAll(".status-text").data([message]);
        loadingGroup.enter()
            .append("text")
            .attr("class", "status-text")
            .attr("x", width / 2)
            .attr("y", height - 30)
            .merge(loadingGroup)
            .text(d => d);
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

    simulation.on("tick", () => {
        graphGroup.selectAll('.link')
            .each(function(d) {
                const source = d.source;
                const target = d.target;
                if (source && target && typeof source.x === 'number' && typeof target.x === 'number') {
                    d3.select(this)
                        .attr("x1", source.x).attr("y1", source.y)
                        .attr("x2", target.x).attr("y2", target.y);
                }
            });
        graphGroup.selectAll('.node').attr("transform", d => `translate(${d.x || 0},${d.y || 0})`);
    });

    function detectCrossConnections() {
        crossConnections = [];
        // Add your cross-connection detection logic here
    }

    async function toggleExampleForNode(nodeData) {
        if (!nodeData || !nodeData.clusterId) return;
        
        const cluster = graphClusters.get(nodeData.clusterId);
        if (!cluster) return;

        const exampleNodeId = `${nodeData.id}-example`;
        const existingExample = cluster.nodes.find(n => n.id === exampleNodeId);

        if (existingExample) {
            // Remove example
            cluster.nodes = cluster.nodes.filter(n => n.id !== exampleNodeId);
            cluster.links = cluster.links.filter(l => l.target !== exampleNodeId);
        } else {
            // Add example
            try {
                const data = await fetchData(nodeData.text, 'example', 0, 1);
                if (data && data.nodes && data.nodes.length > 0) {
                    const exampleNode = {
                        ...data.nodes[0],
                        id: exampleNodeId,
                        type: 'example',
                        clusterId: nodeData.clusterId,
                        visible: true,
                        x: (nodeData.x || 0) + 100,
                        y: (nodeData.y || 0) + 50
                    };
                    cluster.nodes.push(exampleNode);
                    cluster.links.push({ source: nodeData.id, target: exampleNodeId });
                }
            } catch (error) {
                console.error("Error fetching example:", error);
            }
        }
        updateGraph();
    }   

    function promptForInitialWord() {
        const inputOverlay = document.getElementById('input-overlay');
        const overlayInput = document.getElementById('overlay-input');
        
        if (!inputOverlay || !overlayInput) {
            const word = prompt("Enter a word to explore:");
            if (word && word.trim()) {
                createNewGraph(word.trim(), 'meaning');
            }
            return;
        }
        
        overlayInput.placeholder = "Type a word and press Enter...";
        inputOverlay.classList.add('visible');
        overlayInput.focus();
        overlayInput.value = '';
        
        const handleKeyDown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const value = overlayInput.value.trim();
                if (value) createNewGraph(value, 'meaning'); 
                inputOverlay.classList.remove('visible');
                overlayInput.removeEventListener('keydown', handleKeyDown);
                overlayInput.removeEventListener('blur', handleBlur);
            }
        };
        
        const handleBlur = () => {
            setTimeout(() => {
                inputOverlay.classList.remove('visible');
                overlayInput.removeEventListener('keydown', handleKeyDown);
                overlayInput.removeEventListener('blur', handleBlur);
            }, 100);
        };
        
        overlayInput.addEventListener('keydown', handleKeyDown);
        overlayInput.addEventListener('blur', handleBlur);
    }
          
    function handleDockClick(event) {
        const button = event.target.closest('button');
        if (!button) return;
        
        const dataType = button.dataset.type;
        if (dataType) {
            if (!currentActiveCentralWord) {
                alert("Please add a word first by clicking the '+' icon.");
                return;
            }
            if (dataType === 'translation' && languageModal && languageList) {
                const langList = document.getElementById('language-list');
                if (langList) {
                    langList.onclick = (e) => {
                        if (e.target.tagName === 'LI') {
                            const lang = e.target.dataset.lang;
                            languageModal.classList.remove('visible');
                            createNewGraph(currentActiveCentralWord, 'translation', { language: lang });
                            langList.onclick = null;
                        }
                    };
                }
                languageModal.classList.add('visible');
            } else {
                createNewGraph(currentActiveCentralWord, dataType);
            }
        }
    }

    function handleZoomControlsClick(event) {
        const button = event.target.closest('button');
        if (!button) return;
        
        const action = button.dataset.action;
        const currentTransform = d3.zoomTransform(svg.node());
        
        switch (action) {
            case 'zoom-in':
                svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.5);
                break;
            case 'zoom-out':
                svg.transition().duration(300).call(zoomBehavior.scaleBy, 1 / 1.5);
                break;
            case 'zoom-reset':
                svg.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity);
                break;
        }
    }

    function handleRegisterToggle() {
        stopRegisterButtonAnimation();
        currentRegister = (currentRegister === 'conversational') ? 'academic' : 'conversational';
        if (registerToggleBtn) {
            registerToggleBtn.classList.toggle('is-academic', currentRegister === 'academic');
        }
    }

    function focusOnCentralNode(clusterId) {
        const cluster = graphClusters.get(clusterId);
        if (cluster && cluster.nodes.length > 0 && cluster.nodes[0].isCentral) {
            const centralNode = cluster.nodes[0];
            currentActiveCentralWord = centralNode.word;
            currentActiveClusterId = clusterId;
            currentView = cluster.currentView;
            updateActiveButton();
            panToNode(cluster.center, 1.2);
        }
    }

    function createInteractiveText(d3Element, text, onWordClick) {
        if (!text || typeof text !== 'string') return;
        
        const words = text.split(/(\s+)/);
        const container = d3Element.append('div').style('line-height', '1.4');
        
        words.forEach(word => {
            if (word.trim() && /^[a-zA-Z]+$/.test(word.trim())) {
                container.append('span')
                    .attr('class', 'interactive-word')
                    .style('cursor', 'pointer')
                    .style('text-decoration', 'underline')
                    .style('text-decoration-color', 'var(--primary-coral)')
                    .text(word)
                    .on('click', function(event) {
                        event.stopPropagation();
                        onWordClick(word.trim());
                    });
            } else {
                container.append('span').text(word);
            }
        });
    }

    const CLUSTER_SPACING = 900;
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
                node.x = targetX;
                node.y = targetY;
                cluster.center.x = targetX;
                cluster.center.y = targetY;
                if (i === lastNodeIndex) {
                    lastNodeCenter = { x: targetX, y: targetY };
                }
            }
        });
        simulation.alpha(0.5).restart();
        return lastNodeCenter;
    }

    function handleResize() {
        const { width, height } = graphContainer.getBoundingClientRect();
        svg.attr("width", width).attr("height", height);
        simulation.force("center", d3.forceCenter(width / 2, height / 2));
        simulation.alpha(0.1).restart();
    }

    async function fetchMoreNodes() {
        const cluster = graphClusters.get(currentActiveClusterId);
        if (!currentActiveClusterId || !cluster || !viewState.hasMore) return;
        
        const addNodeElement = graphGroup.selectAll('.node').filter(d => d.type === 'add' && d.clusterId === currentActiveClusterId);
        if (addNodeElement.classed('is-loading')) return;
        addNodeElement.classed('is-loading', true);
        
        try {
            const data = await fetchData(cluster.nodes[0].word, cluster.currentView, viewState.offset, 3);
            if (data.nodes && data.nodes.length > 0) {
                data.nodes.forEach(newNodeData => {
                    const newNodeId = `${currentActiveClusterId}-${(newNodeData.text || '').slice(0, 10)}-${cluster.currentView}`;
                    if (!cluster.nodes.some(n => n.id === newNodeId)) {
                        const newNode = { 
                            ...newNodeData, 
                            id: newNodeId, 
                            type: cluster.currentView, 
                            clusterId: currentActiveClusterId, 
                            visible: true,
                            x: cluster.center.x + Math.random() * 200 - 100,
                            y: cluster.center.y + Math.random() * 200 - 100
                        };
                        cluster.nodes.push(newNode);
                        cluster.links.push({ source: `central-${currentActiveClusterId}`, target: newNodeId });
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
        } finally {
            addNodeElement.classed('is-loading', false);
            if (!viewState.hasMore) {
                addNodeElement.classed('is-disabled', true);
            }
        }
    }
    
    function updateActiveButton() {
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === currentView);
        });
    }
   
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    }
    
    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
    
    function saveAsPng() {
        // Simple implementation - would need more sophisticated approach for full functionality
        const svgElement = document.getElementById('wordsplainer-graph-svg');
        if (svgElement) {
            const svgData = new XMLSerializer().serializeToString(svgElement);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const pngFile = canvas.toDataURL("image/png");
                const downloadLink = document.createElement("a");
                downloadLink.download = "wordsplainer-graph.png";
                downloadLink.href = pngFile;
                downloadLink.click();
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
        }
    }
    
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    // --- Initialization ---
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 5])
        .on("zoom", (event) => {
            graphGroup.attr("transform", event.transform);
        });
    
    svg.call(zoomBehavior);

    // Initialize the graph
    renderInitialPrompt();
    
    // Event listeners
    if (controlsDock) {
        controlsDock.addEventListener('click', handleDockClick);
    }
    
    if (zoomControls) {
        zoomControls.addEventListener('click', handleZoomControlsClick);
    }
    
    if (registerToggleBtn) {
        registerToggleBtn.addEventListener('click', handleRegisterToggle);
    }
    
    // Modal close functionality
    if (modalCloseBtn && languageModal) {
        modalCloseBtn.addEventListener('click', () => {
            languageModal.classList.remove('visible');
        });
    }
    
    // Close modal when clicking outside
    if (languageModal) {
        languageModal.addEventListener('click', (event) => {
            if (event.target === languageModal) {
                languageModal.classList.remove('visible');
            }
        });
    }
    
    window.addEventListener('resize', handleResize);
    
    // Initialize SVG dimensions
    handleResize();
});