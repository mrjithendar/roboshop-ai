# Diagrams

| Diagram | Mermaid source | Rendered |
| --- | --- | --- |
| Services and data ownership | `eks-system-context.mmd` | `svg/eks-system-context.svg` |
| AWS network and ingress | `eks-network.mmd` | `svg/eks-network.svg` |
| A normal shopping request | `eks-shopping-request.mmd` | `svg/eks-shopping-request.svg` |
| Assistant and MCP paths | `eks-ai-paths.mmd` | `svg/eks-ai-paths.svg` |
| Checkout, outbox and consumers | `eks-checkout-events.mmd` | `svg/eks-checkout-events.svg` |
| Trust and authorization boundaries | `eks-trust-boundaries.mmd` | `svg/eks-trust-boundaries.svg` |
| KEDA and Karpenter scaling chain | `eks-scaling-chain.mmd` | `svg/eks-scaling-chain.svg` |
| Telemetry pipeline | `eks-telemetry.mmd` | `svg/eks-telemetry.svg` |

The SVGs are drawn by `build_diagrams.py` (Python standard library, no network) so the layout is
controlled and readable at phone width (720 px wide, ≥ 11.5 px text, one concern per diagram).
Every SVG has a `<title>` and a full-sentence `<desc>` for screen readers. The `.mmd` files are
the editable equivalents (render with any Mermaid tool); when a component or call changes,
update both and run:

```bash
python3 deploy/eks/diagrams/build_diagrams.py
```

Line styles: solid grey = synchronous HTTP; thick red = asynchronous event; dashed green =
telemetry; dotted purple = control-plane action; dashed border = optional component.
