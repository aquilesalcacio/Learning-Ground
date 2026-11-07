"use client";

import { FieldSelect, MockBadge } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateProfile, useLgState } from "@/lib/lg-store";
import { LANGUAGE_OPTIONS } from "@/lib/lg-types";

export function ProfileView() {
  const { profile } = useLgState();

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Student Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your tutor reads this at the start of a session. Changes save automatically in this browser.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              placeholder="Your name"
              value={profile.name}
              onChange={(event) => updateProfile({ name: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-school">School</Label>
            <Input
              id="profile-school"
              placeholder="Your school"
              value={profile.school}
              onChange={(event) => updateProfile({ school: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-courses">Courses</Label>
            <Textarea
              id="profile-courses"
              rows={3}
              placeholder="One course per line"
              value={profile.courses}
              onChange={(event) => updateProfile({ courses: event.target.value })}
            />
          </div>
          <FieldSelect
            id="profile-language"
            label="Preferred language"
            value={profile.language}
            options={LANGUAGE_OPTIONS}
            placeholder="Choose a language"
            onChange={(language) => updateProfile({ language })}
          />
          <div className="grid gap-2">
            <Label htmlFor="profile-struggles">What&apos;s hard for you</Label>
            <Textarea
              id="profile-struggles"
              rows={4}
              placeholder="Topics or habits you want help with"
              value={profile.struggles}
              onChange={(event) => updateProfile({ struggles: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Canvas LMS <MockBadge label="Concept" />
          </CardTitle>
          <CardDescription>
            Importing courses would go through an institution-approved OAuth or LTI app. It isn&apos;t built.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" disabled>
            Import from Canvas LMS
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
