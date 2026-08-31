import Type from "typebox";

import { createActorIdSchema } from "./identifiers.js";

const attributableActor = <const ActorType extends string>(actorType: ActorType) =>
  Type.Object(
    {
      actor_id: createActorIdSchema(),
      actor_type: Type.Literal(actorType),
    },
    { additionalProperties: false },
  );

export const ActorRefSchema = Type.Union(
  [
    attributableActor("customer"),
    attributableActor("member"),
    Type.Object(
      {
        actor_id: Type.Null(),
        actor_type: Type.Literal("system"),
      },
      { additionalProperties: false },
    ),
    attributableActor("platform_operator"),
  ],
  {
    $id: "ActorRef.v1",
    description:
      "Event attribution only. Runtime validation does not authenticate or authorize the actor.",
  },
);
export type ActorRef = Type.Static<typeof ActorRefSchema>;
