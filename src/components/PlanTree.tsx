import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PlanNode } from "../types";
import { layoutPlan, NODE_W } from "../lib/planLayout";
import { STATUS_LABEL } from "../lib/transcript";

export function PlanTree({ plan }: { plan: PlanNode[] }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = layoutPlan(plan).map(({ node, x, y }) => ({
      id: node.id,
      position: { x, y },
      draggable: false,
      connectable: false,
      className: `plan-node status-${node.status}`,
      style: { width: NODE_W },
      data: {
        label: (
          <div
            title={[node.summary, node.note].filter(Boolean).join("\n\n")}
            data-testid={`plan-${node.id}`}
            data-status={node.status}
          >
            <div className="plan-node-title">{node.title}</div>
            <div className="plan-node-status">{STATUS_LABEL[node.status]}</div>
          </div>
        ),
      },
    }));
    const edges: Edge[] = plan.flatMap((n) =>
      n.depends_on.map((d) => ({ id: `${d}->${n.id}`, source: d, target: n.id, className: "plan-edge" })),
    );
    return { nodes, edges };
  }, [plan]);

  if (!plan.length) {
    return <p className="muted pad">El plan aparece cuando termina el diagnóstico.</p>;
  }

  return (
    <div className="plan-canvas" data-testid="plan-tree">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
